"""AI Batch Fill Multi-table API — POST /api/ai/batch-fill-multi"""

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

router = APIRouter(prefix="/api/ai", tags=["AI Batch Fill Multi"])

UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ── Schemas ──

class BatchFillMultiRequest(BaseModel):
    table_ids: List[int]
    rule_text: str
    scope: Optional[str] = "multi"  # "multi" or "global"


# ── Helpers (reused from ai_batch_fill) ──

def _get_table_and_ds(db: Session, table_id: int, user):
    tc = db.query(TableConfig).filter(
        TableConfig.id == table_id,
        TableConfig.is_deleted == 0,
        TableConfig.status == "enabled",
    ).first()
    if not tc:
        return None, None

    permitted_ids = get_permitted_datasource_ids(db, user)
    if permitted_ids is not None and tc.datasource_id not in permitted_ids:
        return None, None

    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == tc.datasource_id,
        DatasourceConfig.is_deleted == 0,
    ).first()
    if not ds:
        return None, None

    return tc, ds


def _get_fields_list(db: Session, table_id: int) -> list[dict]:
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


async def _process_single_table(
    db: Session, table_id: int, rule_text: str, user, ai_engine: AIEngine,
) -> dict:
    """Process batch fill for a single table, return result dict."""
    tc, ds = _get_table_and_ds(db, table_id, user)
    if not tc or not ds:
        return {
            "table_id": table_id,
            "table_name": t("ai_batch_fill_multi.unknown"),
            "display_name": t("ai_batch_fill_multi.unknown"),
            "status": "error",
            "error": t("ai_batch_fill_multi.table_error"),
            "rows_changed": 0,
            "fields_changed": [],
            "changes": [],
        }

    fields_list = _get_fields_list(db, table_id)
    pk_fields = [f.strip() for f in tc.primary_key_fields.split(",")]

    # Reject dangerous operations
    rule_lower = rule_text.strip().lower()
    if any(w in rule_lower for w in ("删除", "drop", "delete", "truncate", "remove")):
        return {
            "table_id": table_id,
            "table_name": tc.table_alias or tc.table_name,
            "display_name": tc.table_name,
            "status": "error",
            "error": t("ai_batch_fill_multi.delete_not_supported"),
            "rows_changed": 0,
            "fields_changed": [],
            "changes": [],
        }

    # Step 1: Try rules engine
    parsed_rule = parse_rule_text(rule_text, fields_list)
    engine_used = "rules"

    # Step 2: If rules engine failed, try LLM
    if parsed_rule is None:
        llm_client = ai_engine.get_llm_client()
        if llm_client:
            try:
                messages = build_llm_prompt(rule_text, fields_list)
                resp = await llm_client.chat(messages, temperature=0.1, max_tokens=1024)
                content = resp.get("content", "")
                parsed_rule = parse_llm_response(content)
                engine_used = "llm"

                if parsed_rule and "error" in parsed_rule:
                    return {
                        "table_id": table_id,
                        "table_name": tc.table_alias or tc.table_name,
                        "display_name": tc.table_name,
                        "status": "error",
                        "error": parsed_rule["error"],
                        "rows_changed": 0,
                        "fields_changed": [],
                        "changes": [],
                    }
            except Exception:
                pass

    if parsed_rule is None:
        return {
            "table_id": table_id,
            "table_name": tc.table_alias or tc.table_name,
            "display_name": tc.table_name,
            "status": "skipped",
            "error": t("ai_batch_fill_multi.parse_failed"),
            "rows_changed": 0,
            "fields_changed": [],
            "changes": [],
        }

    # Validate target field
    target_field = parsed_rule.get("target_field", "")
    target_field_config = None
    for f in fields_list:
        if f["field_name"] == target_field:
            target_field_config = f
            break

    if not target_field_config:
        return {
            "table_id": table_id,
            "table_name": tc.table_alias or tc.table_name,
            "display_name": tc.table_name,
            "status": "skipped",
            "error": t("ai_batch_fill_multi.field_not_found", field=target_field),
            "rows_changed": 0,
            "fields_changed": [],
            "changes": [],
        }

    if target_field_config.get("is_primary_key") or target_field_config.get("is_system_field"):
        return {
            "table_id": table_id,
            "table_name": tc.table_alias or tc.table_name,
            "display_name": tc.table_name,
            "status": "skipped",
            "error": t("ai_batch_fill_multi.pk_or_system"),
            "rows_changed": 0,
            "fields_changed": [],
            "changes": [],
        }

    # Step 3: Fetch data
    try:
        all_data = _fetch_all_data(ds, tc, fields_list)
    except Exception as e:
        return {
            "table_id": table_id,
            "table_name": tc.table_alias or tc.table_name,
            "display_name": tc.table_name,
            "status": "error",
            "error": t("ai_batch_fill_multi.fetch_failed", error=str(e)),
            "rows_changed": 0,
            "fields_changed": [],
            "changes": [],
        }

    if not all_data:
        return {
            "table_id": table_id,
            "table_name": tc.table_alias or tc.table_name,
            "display_name": tc.table_name,
            "status": "skipped",
            "error": t("ai_batch_fill_multi.no_data"),
            "rows_changed": 0,
            "fields_changed": [],
            "changes": [],
        }

    # Step 4: Apply rule
    changes = apply_rule_to_data(parsed_rule, all_data, fields_list, pk_fields)

    if not changes:
        return {
            "table_id": table_id,
            "table_name": tc.table_alias or tc.table_name,
            "display_name": tc.table_name,
            "status": "no_change",
            "error": None,
            "rows_changed": 0,
            "fields_changed": [],
            "changes": [],
            "explanation": build_explanation(parsed_rule, fields_list) + "（没有匹配的记录）",
            "engine": engine_used,
        }

    changed_fields = list(set(c["field"] for c in changes))
    explanation = build_explanation(parsed_rule, fields_list)

    return {
        "table_id": table_id,
        "table_name": tc.table_alias or tc.table_name,
        "display_name": tc.table_name,
        "status": "has_changes",
        "error": None,
        "rows_changed": len(set(c["pk_value"] for c in changes)),
        "fields_changed": changed_fields,
        "total_changes": len(changes),
        "changes": changes[:500],
        "explanation": explanation,
        "engine": engine_used,
        "parsed_rule": parsed_rule,
    }


# ── API Endpoints ──

@router.post("/batch-fill-multi")
async def batch_fill_multi_preview(
    body: BatchFillMultiRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    """Parse natural language rule and preview batch modifications across multiple tables."""
    ai_engine = AIEngine(db)

    if not ai_engine.is_enabled:
        raise HTTPException(400, t("ai.not_enabled"))
    if not ai_engine.is_feature_enabled("batch_fill"):
        raise HTTPException(400, t("ai.batch_fill_not_enabled"))

    if not body.table_ids and body.scope != "global":
        raise HTTPException(400, t("ai_batch_fill_multi.select_table"))

    # If scope is "global", fetch all enabled tables
    if body.scope == "global":
        all_tables = db.query(TableConfig).filter(
            TableConfig.is_deleted == 0,
            TableConfig.status == "enabled",
        ).all()
        permitted_ids = get_permitted_datasource_ids(db, user)
        if permitted_ids is not None:
            all_tables = [t for t in all_tables if t.datasource_id in permitted_ids]
        table_ids = [t.id for t in all_tables]
    else:
        table_ids = body.table_ids

    if not table_ids:
        raise HTTPException(400, t("ai_batch_fill_multi.no_tables"))

    # Process each table
    tables_result = []
    total_rows_changed = 0
    tables_affected = 0

    for tid in table_ids:
        result = await _process_single_table(db, tid, body.rule_text, user, ai_engine)
        tables_result.append(result)
        if result["status"] == "has_changes":
            total_rows_changed += result["rows_changed"]
            tables_affected += 1

    # Save multi-table preview data for later confirmation
    session_id = uuid.uuid4().hex[:12]
    preview_file = os.path.join(UPLOAD_DIR, f"multi_preview_{session_id}.json")
    with open(preview_file, "w", encoding="utf-8") as f:
        json.dump({
            "session_id": session_id,
            "rule_text": body.rule_text,
            "scope": body.scope,
            "tables": tables_result,
        }, f, ensure_ascii=False)

    log_operation(
        db, "AI批量修改", "多表预览", "success",
        target_id=None, target_name=None,
        message=f"AI多表批量修改预览：{tables_affected} 张表受影响，共 {total_rows_changed} 条记录",
        operator=user.username if user else "system",
    )
    db.commit()

    return {
        "success": True,
        "data": {
            "session_id": session_id,
            "summary": {
                "tables_affected": tables_affected,
                "total_rows_changed": total_rows_changed,
                "total_tables": len(table_ids),
            },
            "tables": tables_result,
        },
    }
