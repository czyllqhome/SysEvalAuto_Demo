"""Stable questionnaire CSV row definitions and reversible formula escaping."""

def escaped(value):
    """Double literal apostrophes; protect formula-like text including leading space."""
    if value.startswith(("'", "\t", "\r", "\n")) or value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def unescaped(value):
    if value.startswith("'") and escaped(value[1:]) == value:
        return value[1:]
    return value


def choices_text(choices):
    return "；".join(f"{o['value']}={o['label']}" for o in choices)


def row_definitions(definition, slots):
    rows = []
    deployments = next(q for q in definition["questions"] if q["id"] == "DEP-01")["options"]
    for q in definition["questions"]:
        condition = "；".join(f"{key} 为 {'/'.join(values)}" for key, values in q["when"].items())
        prefix = ("适用条件：" + condition + "。") if condition else ""
        choices = q["options"]
        if q["kind"] == "deployment":
            choices = [{"value": "provided", "label": "填写明细"}, {"value": "unknown", "label": "待确认"}]

        def add(path, label, instruction, allowed=None, multi=False, q=q, prefix=prefix):
            rows.append({"id": q["id"] + "." + ".".join(path), "question_id": q["id"],
                         "path": path, "question": q["title"], "field": label,
                         "instructions": prefix + instruction, "allowed": allowed, "multi": multi})

        add(["value"], "答案", ("多选用英文分号 ; 分隔。" if q["kind"] == "multi" else "单选。") + choices_text(choices),
            [o["value"] for o in choices], q["kind"] == "multi")
        if q["kind"] == "duration":
            add(["details", "amount"], "可接受中断时长", "答案为 duration 时填写正数，最多六位小数（折算分钟）。")
            add(["details", "unit"], "时间单位", "minutes=分钟；hours=小时；days=天", ["minutes", "hours", "days"])
        elif q["kind"] == "deployment":
            for env in deployments:
                if env["value"] == "unknown":
                    continue
                for field in q["fields"]:
                    add(["details", env["value"], field["key"]], env["label"] + " / " + field["label"],
                        "答案为 provided 且 DEP-01 选中此环境时填写；" + ("选填" if field.get("optional") else "必填，未知填待确认"))
        else:
            for index in range(slots if q["kind"] == "records" else 1):
                for field in q["fields"]:
                    path = ["details"] + ([str(index)] if q["kind"] == "records" else []) + [field["key"]]
                    options = field["options"]
                    hint = "答案启用明细时必填，未知填待确认。"
                    if q["kind"] == "records":
                        hint = "答案为 provided 时从第 1 组连续填写；末尾未使用的整组留空，至少填写一组。"
                    add(path, (f"交互系统 {index + 1} / " if q["kind"] == "records" else "") + field["label"],
                        hint + (choices_text(options) if options else "文本，最多 2000 字。"),
                        [o["value"] for o in options] if options else None)
    return rows


def cell_value(answers, row):
    value = answers.get(row["question_id"], {})
    for key in row["path"]:
        if isinstance(value, list):
            value = value[int(key)] if int(key) < len(value) else ""
        elif isinstance(value, dict):
            value = value.get(key, "")
        else:
            return ""
    return ";".join(value) if isinstance(value, list) else str(value)


def reconstruct(rows, values, definition, slots):
    answers = {}
    for q in definition["questions"]:
        value = values.get(q["id"] + ".value", "")
        if not value:
            continue
        answer = {"value": value.split(";") if q["kind"] == "multi" else value}
        if q["kind"] == "records":
            details = []
            for index in range(slots):
                record = {f["key"]: values[q["id"] + f".details.{index}." + f["key"]] for f in q["fields"]}
                if any(record.values()):
                    details.append(record)
            answer["details"] = details
        else:
            for row in rows:
                if row["question_id"] != q["id"] or row["path"][0] != "details":
                    continue
                target = answer
                for key in row["path"][:-1]:
                    target = target.setdefault(key, {})
                target[row["path"][-1]] = values[row["id"]]
        answers[q["id"]] = answer
    return answers

