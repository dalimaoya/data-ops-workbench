"""AI Batch Fill API — POST /api/ai/batch-fill and POST /api/ai/batch-fill/apply"""

import json
import os
import uuid
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db, DATA_DIR
from app.models import (
    TableConfig, FieldConfig, DatasourceConfig, ImportTaskLog, _now_bjt,
)
from app.utils.crypto import decrypt_password
from app.utils.remote_db import _connect
from app.utils.auth import get_current_user, require_role
from app.utils.permissions import get_permitted_datasource_ids
from app.utils.audit import log_operation
from app.ai.ai_engine import AIEngine
from app.ai.batch_fill_engine import (
    parse_rule_text, apply_rule_to_data, build_explanation,
    build_llm_prompt, parse_llm_response,
)
from app.models import UserAccount
from app.i18n import t

router = APIRouter(prefix="/api/ai", tags=["AI Batch Fill"])

UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ── Schemas ──

class BatchFillRequest(BaseModel):
    table_id: int
    rule_text: str
    data_scope: Optional[str] = "all"  # "all" or future: "filtered"


class BatchFillApplyRequest(BaseModel):
    table_id: int
    changes: List[dict]  # The changes from preview


# ── Helpers ──

def _get_table_and_ds(db: Session, table_id: int, user):
    """Get table config and datasource, with permission check."""
    tc = db.query(TableConfig).filter(
        TableConfig.id == table_id,
        TableConfig.is_deleted == 0,
        TableConfig.status == "enabled",
    ).first()
    if not tc:
        raise HTTPException(404, t("ai_batch_fill.table_not_found"))

    # Permission check
    permitted_ids = get_permitted_datasource_ids(db, user)
    if permitted_ids is not None and tc.datasource_id not in permitted_ids:
        raise HTTPException(403, t("ai_batch_fill.no_permission"))

    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == tc.datasource_id,
        DatasourceConfig.is_deleted == 0,
    ).first()
    if not ds:
        raise HTTPException(404, t("ai_batch_fill.datasource_not_found"))

    return tc, ds


def _get_fields_list(db: Session, table_id: int) -> list[dict]:
    """Get field configs as list of dicts for the batch fill engine."""
    fields = (
        db.query(FieldConfig)
        .filter(FieldConfig.table_config_id == table_id, FieldConfig.is_deleted == 0)
        .order_by(FieldConfig.field_order_no)
        .all()
    )
    return [
        {
            "field_name": f.field_name,
            "field_alias": f.field_alias or f.field_name,
            "db_data_type": f.db_data_type or "",
            "is_editable": f.is_editable,
            "is_primary_key": f.is_primary_key,
            "is_system_field": f.is_system_field,
            "is_displayed": f.is_displayed,
            "include_in_export": f.include_in_export,
        }
        for f in fields
    ]


def _qualified_table(db_type: str, table_name: str, schema: Optional[str]) -> str:
    if db_type in ("postgresql", "kingbase"):
        sch = schema or "public"
        return f'"{sch}"."{table_name}"'
    elif db_type == "sqlserver":
        sch = schema or "dbo"
        return f"[{sch}].[{table_name}]"
    elif db_type in ("oracle", "dm"):
        return f'"{table_name.upper()}"'
    return f"`{table_name}`"


def _quote_col(db_type: str, col: str) -> str:
    if db_type == "sqlserver":
        return f"[{col}]"
    elif db_type in ("mysql", "sqlite"):
        return f"`{col}`"
    elif db_type in ("oracle", "dm"):
        return f'"{col.upper()}"'
    return f'"{col}"'


def _fetch_all_data(ds, tc, fields_list: list[dict]) -> list[dict]:
    """Fetch all data from the managed table."""
    pwd = decrypt_password(ds.password_encrypted)
    displayed_fields = [f for f in fields_list if f["is_displayed"]]
    if not displayed_fields:
        return []

    col_names = [f["field_name"] for f in displayed_fields]
    conn = _connect(
        ds.db_type, ds.host, ds.port, ds.username, pwd,
        tc.db_name, tc.schema_name, ds.charset, ds.connect_timeout_seconds or 10,
    )
    try:
        cur = conn.cursor()
        qt = _qualified_table(ds.db_type, tc.table_name, tc.schema_name)
        cols_sql = ", ".join(_quote_col(ds.db_type, c) for c in col_names)
        cur.execute(f"SELECT {cols_sql} FROM {qt}")
        raw_rows = cur.fetchall()

        result = []
        for raw in raw_rows:
            row = {}
            for i, cn in enumerate(col_names):
                row[cn] = str(raw[i]) if raw[i] is not None else None
            result.append(row)
        return result
    finally:
        conn.close()


# ── API Endpoints ──

@router.post("/batch-fill")
async def batch_fill_preview(
    body: BatchFillRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    """Parse natural language rule and preview batch modifications."""
    ai_engine = AIEngine(db)

    # Check AI feature
    if not ai_engine.is_enabled:
        raise HTTPException(400, t("ai.not_enabled"))
    if not ai_engine.is_feature_enabled("batch_fill"):
        raise HTTPException(400, t("ai.batch_fill_not_enabled"))

    tc, ds = _get_table_and_ds(db, body.table_id, user)
    fields_list = _get_fields_list(db, body.table_id)
    pk_fields = [f.strip() for f in tc.primary_key_fields.split(",")]

    # Reject dangerous operations
    rule_lower = body.rule_text.strip().lower()
    if any(w in rule_lower for w in ("删除", "drop", "delete", "truncate", "remove")):
        raise HTTPException(400, t("ai_batch_fill.delete_not_supported"))

    # Step 1: Try rules engine first
    parsed_rule = parse_rule_text(body.rule_text, fields_list)
    engine_used = "rules"

    # Step 2: If rules engine failed, try LLM
    if parsed_rule is None:
        llm_client = ai_engine.get_llm_client()
        if llm_client:
            try:
                messages = build_llm_prompt(body.rule_text, fields_list)
                resp = await llm_client.chat(messages, temperature=0.1, max_tokens=1024)
                content = resp.get("content", "")
                parsed_rule = parse_llm_response(content)
                engine_used = "llm"

                if parsed_rule and "error" in parsed_rule:
                    raise HTTPException(400, parsed_rule["error"])
            except HTTPException:
                raise
            except Exception as e:
                # LLM failed, fall through
                pass

    if parsed_rule is None:
        raise HTTPException(400, t("ai_batch_fill.parse_failed"))

    # Validate target field is editable
    target_field = parsed_rule.get("target_field", "")
    target_field_config = None
    for f in fields_list:
        if f["field_name"] == target_field:
            target_field_config = f
            break

    if not target_field_config:
        raise HTTPException(400, t("ai_batch_fill.field_not_found", field=target_field))
    if target_field_config.get("is_primary_key"):
        raise HTTPException(400, t("ai_batch_fill.pk_not_allowed"))
    if target_field_config.get("is_system_field"):
        raise HTTPException(400, t("ai_batch_fill.system_field_not_allowed"))

    # Step 3: Fetch data
    all_data = _fetch_all_data(ds, tc, fields_list)
    if not all_data:
        raise HTTPException(400, t("ai_batch_fill.no_data"))

    # Step 4: Apply rule and get changes
    changes = apply_rule_to_data(parsed_rule, all_data, fields_list, pk_fields)

    if not changes:
        return {
            "success": True,
            "data": {
                "parsed_rule": parsed_rule,
                "affected_rows": 0,
                "changes": [],
                "explanation": build_explanation(parsed_rule, fields_list) + "（没有匹配的记录）",
                "engine": engine_used,
            },
        }

    # Count unique fields changed
    changed_fields = set(c["field"] for c in changes)

    explanation = build_explanation(parsed_rule, fields_list)

    log_operation(
        db, "AI批量修改", "预览修改", "success",
        target_id=tc.id, target_name=tc.table_name,
        message=f"AI批量修改预览：{explanation}，影响 {len(changes)} 处",
        operator=user.username if user else "system",
    )
    db.commit()

    return {
        "success": True,
        "data": {
            "parsed_rule": parsed_rule,
            "affected_rows": len(set(c["pk_value"] for c in changes)),
            "affected_fields": len(changed_fields),
            "total_changes": len(changes),
            "changes": changes[:500],  # Limit preview to 500
            "explanation": explanation,
            "engine": engine_used,
        },
    }


@router.post("/batch-fill/apply")
async def batch_fill_apply(
    body: BatchFillApplyRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin", "operator")),
):
    """Apply batch fill changes by creating a temporary import task for diff preview.
    
    This creates a diff JSON file and import task log, then returns the task_id
    so the frontend can redirect to the standard diff preview page.
    """
    tc, ds = _get_table_and_ds(db, body.table_id, user)
    fields_list = _get_fields_list(db, body.table_id)
    pk_fields = [f.strip() for f in tc.primary_key_fields.split(",")]

    if not body.changes:
        raise HTTPException(400, t("ai_batch_fill.no_changes"))

    # Fetch current data to build full import_data for writeback
    all_data = _fetch_all_data(ds, tc, fields_list)
    pk_data_map = {}
    for row in all_data:
        pk_key = "|".join(str(row.get(pk, "")) for pk in pk_fields)
        pk_data_map[pk_key] = row

    # Build diff_rows from changes
    diff_rows = []
    affected_pk_keys = set()
    for change in body.changes:
        pk_value = change.get("pk_value", "")
        affected_pk_keys.add(pk_value)
        diff_rows.append({
            "row_num": change.get("row_index", 0) + 2,  # 1-indexed + header
            "pk_key": pk_value,
            "field_name": change.get("field", ""),
            "field_alias": change.get("field_alias", change.get("field", "")),
            "old_value": change.get("old_value"),
            "new_value": change.get("new_value"),
            "status": "changed",
            "change_type": "update",
        })

    # Build import_data (modified rows with full data)
    import_data = []
    changes_by_pk: dict[str, dict[str, str]] = {}
    for change in body.changes:
        pk = change.get("pk_value", "")
        if pk not in changes_by_pk:
            changes_by_pk[pk] = {}
        changes_by_pk[pk][change.get("field", "")] = change.get("new_value", "")

    for pk_key in affected_pk_keys:
        original_row = pk_data_map.get(pk_key)
        if not original_row:
            continue
        modified_row = dict(original_row)
        for field_name, new_value in changes_by_pk.get(pk_key, {}).items():
            modified_row[field_name] = new_value
        import_data.append({
            "row_num": 0,
            "data": modified_row,
            "pk_key": pk_key,
        })

    # Create import task log
    batch_no = f"AIBF_{_now_bjt().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:4].upper()}"
    task_log = ImportTaskLog(
        import_batch_no=batch_no,
        table_config_id=tc.id,
        datasource_id=tc.datasource_id,
        related_export_batch_no=None,
        import_file_name=f"AI批量修改_{batch_no}",
        import_file_path="",
        template_version=tc.config_version,
        total_row_count=len(affected_pk_keys),
        passed_row_count=len(affected_pk_keys),
        warning_row_count=0,
        failed_row_count=0,
        diff_row_count=len(diff_rows),
        new_row_count=0,
        validation_status="success",
        validation_message=f"AI批量修改：影响 {len(affected_pk_keys)} 行，{len(diff_rows)} 处变更",
        error_detail_json=None,
        import_status="validated",
        operator_user=user.username if user else "system",
    )
    db.add(task_log)
    db.flush()

    # Save diff data
    diff_file = os.path.join(UPLOAD_DIR, f"diff_{task_log.id}.json")
    diff_data = {
        "diff_rows": diff_rows,
        "new_rows": [],
        "import_data": import_data,
    }
    with open(diff_file, "w", encoding="utf-8") as f:
        json.dump(diff_data, f, ensure_ascii=False)

    log_operation(
        db, "AI批量修改", "确认修改", "success",
        target_id=tc.id, target_name=tc.table_name,
        message=f"AI批量修改 {batch_no}，影响 {len(affected_pk_keys)} 行",
        operator=user.username if user else "system",
    )
    db.commit()

    return {
        "success": True,
        "task_id": task_log.id,
        "import_batch_no": batch_no,
        "diff_count": len(diff_rows),
        "affected_rows": len(affected_pk_keys),
    }
