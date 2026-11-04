"""Versioned starter controls and an atomic CSV import contract."""

from __future__ import annotations

import csv
import io

from sqlalchemy import select

from .db import Catalog, Control
from . import methodology
from .domain import APPLICABILITY_TAGS, DOMAINS, LEVELS, DomainError, digest

STARTER = [
    ("IAM-001", "IAM", "L1|L2|L3", "访问边界", "Access boundaries", "明确角色可以读取和修改的业务记录。", "Define which business records each role may read and modify."),
    ("IAM-002", "IAM", "L2|L3", "角色权限验证", "Role permission checks", "通过页面和直接接口验证允许及拒绝场景。", "Verify allowed and denied access through both the UI and API."),
    ("IAM-003", "IAM", "L3", "高权限职责分离", "Privileged separation of duties", "对高影响操作设置独立审批和可追溯授权。", "Require independent approval and traceable authorization for high-impact operations."),
    ("DATA-001", "DATA", "L1|L2|L3", "输入与输出校验", "Input and output validation", "校验必填内容、格式、长度和不可信输入。", "Validate required values, formats, lengths, and untrusted input."),
    ("DATA-002", "DATA", "L2|L3", "敏感数据保护", "Sensitive data protection", "明确数据分类、访问限制及导出边界。", "Specify data sensitivity, access restrictions, and export boundaries."),
    ("DATA-003", "DATA", "L3", "关键数据审查", "Critical data review", "对高度敏感数据的数据流和授权进行独立审查。", "Independently review sensitive data flows and authorization."),
    ("AUDIT-001", "AUDIT", "L1|L2|L3", "基本操作日志", "Operational records", "记录关键操作的时间、对象、结果和责任角色。", "Record time, object, outcome, and accountable role for important operations."),
    ("AUDIT-002", "AUDIT", "L2|L3", "业务审计追踪", "Business audit trail", "能够追溯业务变更、审批以及拒绝访问。", "Trace business changes, approvals, and denied access."),
    ("AUDIT-003", "AUDIT", "L3", "高影响操作复核", "High-impact activity review", "定义高影响操作的复核责任和证据保留。", "Define responsibility and evidence retention for reviewing high-impact activity."),
    ("RES-001", "RESILIENCE", "L1|L2|L3", "恢复说明", "Recovery instructions", "记录故障恢复步骤、业务替代流程和责任人。", "Document recovery steps, business alternatives, and responsible roles."),
    ("RES-002", "RESILIENCE", "L2|L3", "备份恢复验证", "Backup restoration checks", "通过演练验证备份可恢复并记录实测结果。", "Test restoration from backup and retain measured results."),
    ("RES-003", "RESILIENCE", "L3", "关键恢复目标", "Critical recovery objectives", "明确恢复目标并以演练验证关键业务连续性。", "Agree recovery objectives and validate continuity through exercises."),
    ("DEL-001", "DELIVERY", "L1|L2|L3", "验收责任与场景", "Acceptance ownership", "明确业务验收人、成功场景和失败场景。", "Name acceptance owners and define successful and failure scenarios."),
    ("DEL-002", "DELIVERY", "L2|L3", "发布与回退", "Release and rollback", "明确发布审批、监控、回退条件和责任人。", "Define release approval, monitoring, rollback triggers, and accountable roles."),
    ("DEL-003", "DELIVERY", "L3", "独立交付审查", "Independent delivery review", "对关键交付和未解决例外执行独立审查。", "Independently review critical delivery and unresolved exceptions."),
]


def seed_catalog(db, org_id: str):
    if not methodology.LEGACY_FIXTURES_ENABLED:
        return
    if db.scalar(select(Catalog).where(Catalog.org_id == org_id)):
        return
    catalog = Catalog(org_id=org_id, code="INTERNAL-STARTER", version="R1", content_hash=digest(STARTER))
    db.add(catalog)
    db.flush()
    for code, domain, levels, zh_title, en_title, zh_description, en_description in STARTER:
        db.add(Control(org_id=org_id, catalog_id=catalog.id, code=code, domain=domain,
                       levels=levels.split("|"), required=True, translations={
                           "zh": {"title": zh_title, "description": zh_description,
                                  "verification": "提供允许与拒绝场景的可复现验收证据。"},
                           "en": {"title": en_title, "description": en_description,
                                  "verification": "Provide reproducible acceptance evidence for allowed and denied scenarios."}}))


def control_snapshot(control: Control) -> dict:
    from sqlalchemy.orm import object_session
    from .db import ControlMetadata
    db = object_session(control)
    meta = db.get(ControlMetadata, control.id) if db else None
    return {"id": control.id, "code": control.code, "domain": control.domain,
            "levels": control.levels, "required": control.required,
            "translations": control.translations, "tags": control.tags, "catalog_id": control.catalog_id,
            **({"metadata": meta.data} if meta else {})}


def parse_import(raw: bytes) -> tuple[list, list, str]:
    if len(raw) > 10 * 1024 * 1024:
        raise DomainError("FILE_TOO_LARGE")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeError as exc:
        raise DomainError("INVALID_CSV_ENCODING") from exc
    required = {"catalog_code", "catalog_version", "scheme_code", "scheme_revision", "control_code",
                "domain_code", "title", "description", "applicable_levels", "required", "verification_guidance"}
    rows, errors, codes, catalog_keys = [], [], set(), set()
    try:
        reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
        if not reader.fieldnames or not required <= set(reader.fieldnames):
            raise DomainError("CSV_MISSING_COLUMNS", detail=sorted(required - set(reader.fieldnames or [])))
        if len(set(reader.fieldnames)) != len(reader.fieldnames):
            raise DomainError("CSV_DUPLICATE_COLUMNS")
        for number, raw_row in enumerate(reader, 2):
            if number > 10001:
                raise DomainError("TOO_MANY_ROWS")
            if None in raw_row or any(v is None for v in raw_row.values()):
                errors.append({"row": number, "column": "*", "code": "CSV_COLUMN_COUNT"})
                continue
            row = {key: value.strip() for key, value in raw_row.items()}
            for field in required:
                if not row[field]:
                    errors.append({"row": number, "column": field, "code": "REQUIRED_FIELD"})
            validations = {
                "control_code": row["control_code"] not in codes,
                "domain_code": row["domain_code"] in DOMAINS,
                "applicable_levels": bool(row["applicable_levels"]) and set(row["applicable_levels"].split("|")) <= set(LEVELS),
                "required": row["required"] in ("true", "false"),
                "scheme_code": row["scheme_code"] == "SYS-RISK",
                "scheme_revision": row["scheme_revision"] == "R1",
                "applicability_tags": set(filter(None, row.get("applicability_tags", "").split("|"))) <= set(APPLICABILITY_TAGS),
            }
            for field, valid in validations.items():
                if not valid:
                    errors.append({"row": number, "column": field, "code": "CSV_INVALID_VALUE"})
            codes.add(row["control_code"])
            catalog_keys.add((row["catalog_code"], row["catalog_version"]))
            rows.append(row)
    except csv.Error as exc:
        raise DomainError("INVALID_CSV") from exc
    if not rows:
        errors.append({"row": 1, "column": "*", "code": "EMPTY_CATALOG"})
    if len(catalog_keys) > 1:
        errors.append({"row": 1, "column": "catalog_version", "code": "CSV_MULTIPLE_VERSIONS"})
    return rows, errors, digest(sorted(rows, key=lambda row: row["control_code"]))


def publish_import(db, imported) -> Catalog:
    if imported.errors:
        raise DomainError("CSV_HAS_ERRORS")
    first = imported.rows[0]
    existing = db.scalar(select(Catalog).where(Catalog.org_id == imported.org_id,
                                              Catalog.code == first["catalog_code"],
                                              Catalog.version == first["catalog_version"]))
    if existing:
        if existing.content_hash != imported.content_hash:
            raise DomainError("CATALOG_VERSION_CONFLICT", 409)
        imported.published_id = existing.id
        return existing
    catalog = Catalog(org_id=imported.org_id, code=first["catalog_code"], version=first["catalog_version"],
                      content_hash=imported.content_hash)
    db.add(catalog)
    db.flush()
    for row in imported.rows:
        translations = {"en": {"title": row["title"], "description": row["description"],
                               "verification": row["verification_guidance"]}}
        translations["zh"] = {"title": row.get("title_zh") or row["title"],
                               "description": row.get("description_zh") or row["description"],
                               "verification": row.get("verification_guidance_zh") or row["verification_guidance"]}
        db.add(Control(org_id=imported.org_id, catalog_id=catalog.id, code=row["control_code"],
                       domain=row["domain_code"], levels=row["applicable_levels"].split("|"),
                       required=row["required"] == "true", translations=translations,
                       tags=list(filter(None, row.get("applicability_tags", "").split("|")))))
    imported.published_id = catalog.id
    return catalog
