"""Pure answer normalization, validation and deterministic tag derivation."""

from copy import deepcopy
from decimal import Decimal, DecimalException, InvalidOperation

from .questionnaire import MAPPING_VERSION, QUESTIONS, tag_dictionary


class ValidationError(ValueError):
    def __init__(self, errors):
        self.errors = errors
        super().__init__("; ".join(f"{key}: {message}" for key, message in errors.items()))


def value_of(answers, id):
    answer = answers.get(id)
    return answer.get("value") if isinstance(answer, dict) else None


def applicable(question, answers):
    return all(value_of(answers, id) in allowed for id, allowed in question["when"].items())


def needs_details(question, value):
    rule = question["details_when"]
    if rule == "known":
        return bool(value) and value != "unknown" and value != ["unknown"]
    return bool(rule) and value in rule


def normalize(raw, submit=False):
    """Discard inactive answers and validate types even when saving drafts."""
    if not isinstance(raw, dict):
        raise ValidationError({"answers": "答案必须为对象"})
    errors = {}
    answers = {}
    known = {q["id"] for q in QUESTIONS}
    if raw.keys() - known:
        errors["answers"] = "包含未知问题编号"

    def fail(path, message):
        errors[path] = message

    def fields(q, row, path):
        if not isinstance(row, dict):
            fail(path, "明细必须为对象")
            return {}
        if row.keys() - {f["key"] for f in q["fields"]}:
            fail(path, "包含未知明细字段")
        clean = {}
        for f in q["fields"]:
            key = f["key"]
            content = row.get(key, "")
            location = f"{path}.{key}"
            if not isinstance(content, str) or len(content) > 2000:
                fail(location, "请输入不超过 2000 字的文本")
                continue
            content = content.strip()
            if not content:
                if submit and not f.get("optional"):
                    fail(location, "请填写此项；无法确定时可填写待确认")
            elif f["options"] and content not in {o["value"] for o in f["options"]}:
                fail(location, "选项无效")
            clean[key] = content
        return clean

    for q in QUESTIONS:
        id = q["id"]
        if not applicable(q, answers):
            continue
        answer = raw.get(id)
        if answer is None:
            if submit:
                fail(id, "请选择或填写此项")
            continue
        if not isinstance(answer, dict) or answer.keys() - {"value", "details"}:
            fail(id, "答案格式无效")
            continue
        value = deepcopy(answer.get("value"))
        kind = q["kind"]
        allowed = {o["value"] for o in q["options"]}
        if kind == "deployment":
            allowed = {"provided", "unknown"}
        if kind == "multi":
            if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
                fail(id, "请选择有效选项")
                continue
            if any(v not in allowed for v in value) or ("unknown" in value and len(value) > 1):
                fail(id, "待确认不能与其他选项同时选择")
                continue
            value = [o["value"] for o in q["options"] if o["value"] in value]
        elif not isinstance(value, str) or (value and value not in allowed):
            fail(id, "请选择有效选项")
            continue
        if not value:
            if submit:
                fail(id, "请选择此项")
            continue
        clean = {"value": value}
        details = answer.get("details", {})
        if kind == "deployment" and value == "provided":
            deployments = value_of(answers, "DEP-01") or []
            environments = [v for v in deployments if v != "unknown"]
            if not isinstance(details, dict):
                fail(id, "部署明细必须为对象")
            elif not environments:
                # Deployment locations cannot be attributed without an environment.
                clean = {"value": "unknown"}
            else:
                clean["details"] = {
                    env: fields(q, details.get(env, {}), f"{id}.{env}") for env in environments
                }
        elif kind == "duration" and value == "duration":
            if not isinstance(details, dict) or details.keys() - {"amount", "unit"}:
                fail(id, "时长格式无效")
            else:
                amount = details.get("amount", "")
                unit = details.get("unit", "minutes")
                factors = {"minutes": 1, "hours": 60, "days": 1440}
                if not isinstance(unit, str) or unit not in factors:
                    fail(id, "时间单位无效")
                elif amount == "":
                    if submit:
                        fail(id, "请填写正数时长")
                    clean["details"] = {"amount": "", "unit": unit}
                else:
                    try:
                        if len(str(amount)) > 40:
                            raise InvalidOperation
                        minutes = Decimal(str(amount)) * factors[unit]
                        if not minutes.is_finite() or minutes <= 0 or minutes > Decimal("1e12"):
                            raise InvalidOperation
                        if minutes.as_tuple().exponent < -6:
                            raise InvalidOperation
                        clean["details"] = {"amount": format(minutes, "f"), "unit": "minutes"}
                    except (DecimalException, ValueError):
                        fail(id, "请填写有效正数时长（换算后不超过 10^12 分钟，最多六位小数）")
        elif needs_details(q, value):
            if kind == "records":
                if not isinstance(details, list) or len(details) > 100:
                    fail(id, "交互明细必须为列表，最多 100 条")
                else:
                    if submit and not details:
                        fail(id, "请至少填写一个交互系统")
                    clean["details"] = [
                        fields(q, row, f"{id}.{i}") for i, row in enumerate(details)
                    ]
            else:
                clean["details"] = fields(q, details, id)
        answers[id] = clean
    if errors:
        raise ValidationError(errors)
    return answers


def derive_tags(answers):
    """Return sorted unique tags, retaining every contributing structured value."""
    labels = tag_dictionary()
    tags = {}

    def add(choices, value, id, path="value"):
        for option in choices:
            if option["value"] == value and option["tag"]:
                code = option["tag"]
                tag = tags.setdefault(
                    code,
                    {
                        "code": code,
                        "label": labels[code],
                        "mapping_version": MAPPING_VERSION,
                        "sources": [],
                    },
                )
                source = {"question_id": id, "path": path, "answer": value}
                if source not in tag["sources"]:
                    tag["sources"].append(source)

    for q in QUESTIONS:
        answer = answers.get(q["id"])
        if not answer:
            continue
        value = answer["value"]
        for selected in value if isinstance(value, list) else [value]:
            add(q["options"], selected, q["id"])
        if q["kind"] == "records" and value == "provided":
            for i, row in enumerate(answer.get("details", [])):
                for f in q["fields"]:
                    add(f["options"] or [], row.get(f["key"]), q["id"], f"details.{i}.{f['key']}")
    return [tags[code] for code in sorted(tags)]


def has_unknown(value):
    if isinstance(value, dict):
        return any(has_unknown(v) for v in value.values())
    if isinstance(value, list):
        return any(has_unknown(v) for v in value)
    return value in ("unknown", "待确认")


def evaluate(raw, submit=False):
    answers = normalize(raw, submit)
    status = "draft"
    if submit:
        status = "needs_confirmation" if has_unknown(answers) else "complete"
    return {"answers": answers, "tags": derive_tags(answers), "status": status}
