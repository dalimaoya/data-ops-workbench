"""AI Smart Fill API — POST /api/ai/smart-fill

Detects patterns in partially-filled data and suggests values for blank cells.
Strategies: increment detection, frequency fill, association fill, LLM enhanced.
"""

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
from app.ai.smart_fill_engine import (
    detect_patterns_for_field,
    generate_fill_suggestions,
    build_llm_smart_fill_prompt,
    parse_llm_smart_fill_response,
)
from app.models import UserAccount
from app.i18n import t

router = APIRouter(prefix="/api/ai", tags=["AI Smart Fill"])

UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ── Schemas ──

class SmartFillDetectRequest(BaseModel):
    table_id: int
    target_fields: List[str]  # field names to analyze
    use_llm: Optional[bool] = False  # whether to attempt LLM enhancement


class SmartFillSuggestion(BaseModel):
    row_index: int
    suggested_value: str
    confidence: float


class SmartFillApplyRequest(BaseModel):
    table_id: int
    fills: List[dict]  # [{"row_index": int, "field": str, "value": str}, ...]


# ── Helpers (shared with ai_batch_fill) ──

def _get_table_and_ds(db: Session, table_id: int, user):
    tc = db.query(TableConfig).filter(
        TableConfig.id == table_id,
        TableConfig.is_deleted == 0,
        TableConfig.status == "enabled",
    ).first()
    if not tc:
        raise HTTPException(404, t("ai_batch_fill.table_not_found"))

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


# ── API Endpoints ──

@router.post("/smart-fill")
async def smart_fill_detect(
    body: SmartFillDetectRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    """Detect patterns in specified columns and suggest fill values for blanks."""
    ai_engine = AIEngine(db)

    if not ai_engine.is_enabled:
        raise HTTPException(400, t("ai.not_enabled"))
    if not ai_engine.is_feature_enabled("batch_fill"):
        raise HTTPException(400, t("ai.batch_fill_not_enabled"))

    tc, ds = _get_table_and_ds(db, body.table_id, user)
    fields_list = _get_fields_list(db, body.table_id)

    # Validate target fields
    field_name_set = {f["field_name"] for f in fields_list}
    for tf in body.target_fields:
        if tf not in field_name_set:
            raise HTTPException(400, t("ai_smart_fill.field_not_found", field=tf))

    # Fetch data
    all_data = _fetch_all_data(ds, tc, fields_list)
    if not all_data:
        raise HTTPException(400, t("ai_smart_fill.no_data"))

    results = {}
    for target_field in body.target_fields:
        # Find blank count
        blank_count = sum(
            1 for row in all_data
            if row.get(target_field) is None or str(row.get(target_field, "")).strip() == ""
        )
        filled_count = len(all_data) - blank_count

        if blank_count == 0:
            results[target_field] = {
                "field_alias": _get_alias(target_field, fields_list),
                "blank_count": 0,
                "filled_count": filled_count,
                "patterns": [],
                "suggestions": [],
                "message": t("ai_smart_fill.no_blank"),
            }
            continue

        if filled_count < 2:
            results[target_field] = {
                "field_alias": _get_alias(target_field, fields_list),
                "blank_count": blank_count,
                "filled_count": filled_count,
                "patterns": [],
                "suggestions": [],
                "message": t("ai_smart_fill.too_few"),
            }
            continue

        # Run pattern detection
        patterns = detect_patterns_for_field(target_field, all_data, fields_list)

        # If no rule pattern found and LLM requested, try LLM
        if not patterns and body.use_llm:
            llm_client = ai_engine.get_llm_client()
            if llm_client:
                try:
                    field_info = next((f for f in fields_list if f["field_name"] == target_field), {})
                    blank_indices = [
                        i for i, row in enumerate(all_data)
                        if row.get(target_field) is None or str(row.get(target_field, "")).strip() == ""
                    ]
                    messages = build_llm_smart_fill_prompt(
                        target_field,
                        field_info.get("field_alias", target_field),
                        field_info.get("db_data_type", "text"),
                        all_data,
                        blank_indices,
                    )
                    resp = await llm_client.chat(messages, temperature=0.1, max_tokens=2048)
                    content = resp.get("content", "")
                    llm_result = parse_llm_smart_fill_response(content, blank_indices)
                    if llm_result and "suggestions" in llm_result:
                        llm_suggestions = []
                        for s in llm_result["suggestions"]:
                            ri = s.get("row_index", 0)
                            # Adjust for 1-indexed from LLM
                            if ri > 0 and ri <= len(all_data):
                                ri_0 = ri - 1
                            else:
                                ri_0 = ri
                            llm_suggestions.append({
                                "row_index": ri_0,
                                "suggested_value": str(s.get("value", "")),
                                "confidence": llm_result.get("confidence", 0.6),
                            })
                        results[target_field] = {
                            "field_alias": _get_alias(target_field, fields_list),
                            "blank_count": blank_count,
                            "filled_count": filled_count,
                            "patterns": [{
                                "type": "llm",
                                "confidence": llm_result.get("confidence", 0.6),
                                "description": llm_result.get("pattern_description", "AI 模式识别"),
                            }],
                            "suggestions": llm_suggestions[:200],
                            "engine": "llm",
                        }
                        continue
                except Exception:
                    pass  # Fall through to empty result

        # Generate suggestions using best pattern
        suggestions = []
        if patterns:
            best_pattern = patterns[0]
            suggestions = generate_fill_suggestions(target_field, best_pattern, all_data, fields_list)

        results[target_field] = {
            "field_alias": _get_alias(target_field, fields_list),
            "blank_count": blank_count,
            "filled_count": filled_count,
            "patterns": patterns,
            "suggestions": suggestions[:200],  # Limit
            "engine": "rules" if patterns else "none",
        }

    log_operation(
        db, "AI智能填充", "模式检测", "success",
        target_id=tc.id, target_name=tc.table_name,
        message=f"AI智能填充检测：{', '.join(body.target_fields)}",
        operator=user.username if user else "system",
    )
    db.commit()

    return {
        "success": True,
        "data": {
            "table_id": body.table_id,
            "table_name": tc.table_name,
            "table_alias": tc.table_alias or tc.table_name,
            "total_rows": len(all_data),
            "fields": results,
        },
    }


@router.post("/smart-fill/apply")
async def smart_fill_apply(
    body: SmartFillApplyRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin", "operator")),
):
    """Apply smart fill suggestions — creates import task for diff preview."""
    tc, ds = _get_table_and_ds(db, body.table_id, user)
    fields_list = _get_fields_list(db, body.table_id)
    pk_fields = [f.strip() for f in tc.primary_key_fields.split(",")]

    if not body.fills:
        raise HTTPException(400, t("ai_smart_fill.no_fill_data"))

    # Fetch current data
    all_data = _fetch_all_data(ds, tc, fields_list)
    pk_data_map = {}
    for i, row in enumerate(all_data):
        pk_key = "|".join(str(row.get(pk, "")) for pk in pk_fields)
        pk_data_map[(i, pk_key)] = row

    # Build row_index -> pk_key mapping
    idx_to_pk = {}
    for i, row in enumerate(all_data):
        pk_key = "|".join(str(row.get(pk, "")) for pk in pk_fields)
        idx_to_pk[i] = pk_key

    # Build diff_rows and import_data
    diff_rows = []
    changes_by_pk: dict[str, dict[str, str]] = {}
    affected_pk_keys = set()

    for fill in body.fills:
        row_idx = fill.get("row_index", -1)
        field_name = fill.get("field", "")
        new_value = fill.get("value", "")

        if row_idx < 0 or row_idx >= len(all_data):
            continue

        pk_key = idx_to_pk.get(row_idx, "")
        if not pk_key:
            continue

        old_value = all_data[row_idx].get(field_name)
        old_str = str(old_value) if old_value is not None else None

        # Find field alias
        field_alias = field_name
        for f in fields_list:
            if f["field_name"] == field_name:
                field_alias = f.get("field_alias") or field_name
                break

        affected_pk_keys.add(pk_key)
        diff_rows.append({
            "row_num": row_idx + 2,
            "pk_key": pk_key,
            "field_name": field_name,
            "field_alias": field_alias,
            "old_value": old_str,
            "new_value": new_value,
            "status": "changed",
            "change_type": "update",
        })

        if pk_key not in changes_by_pk:
            changes_by_pk[pk_key] = {}
        changes_by_pk[pk_key][field_name] = new_value

    if not diff_rows:
        raise HTTPException(400, t("ai_smart_fill.no_valid_fill"))

    # Build import_data
    import_data = []
    for pk_key in affected_pk_keys:
        # Find original row by pk_key
        original_row = None
        for i, row in enumerate(all_data):
            rk = "|".join(str(row.get(pk, "")) for pk in pk_fields)
            if rk == pk_key:
                original_row = row
                break
        if not original_row:
            continue
        modified_row = dict(original_row)
        for fn, nv in changes_by_pk.get(pk_key, {}).items():
            modified_row[fn] = nv
        import_data.append({
            "row_num": 0,
            "data": modified_row,
            "pk_key": pk_key,
        })

    # Create import task log
    batch_no = f"AISF_{_now_bjt().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:4].upper()}"
    task_log = ImportTaskLog(
        import_batch_no=batch_no,
        table_config_id=tc.id,
        datasource_id=tc.datasource_id,
        related_export_batch_no=None,
        import_file_name=f"AI智能填充_{batch_no}",
        import_file_path="",
        template_version=tc.config_version,
        total_row_count=len(affected_pk_keys),
        passed_row_count=len(affected_pk_keys),
        warning_row_count=0,
        failed_row_count=0,
        diff_row_count=len(diff_rows),
        new_row_count=0,
        validation_status="success",
        validation_message=f"AI智能填充：填充 {len(diff_rows)} 个空白单元格",
        error_detail_json=None,
        import_status="validated",
        operator_user=user.username if user else "system",
    )
    db.add(task_log)
    db.flush()

    diff_file = os.path.join(UPLOAD_DIR, f"diff_{task_log.id}.json")
    diff_data = {
        "diff_rows": diff_rows,
        "new_rows": [],
        "import_data": import_data,
    }
    with open(diff_file, "w", encoding="utf-8") as f:
        json.dump(diff_data, f, ensure_ascii=False)

    log_operation(
        db, "AI智能填充", "确认填充", "success",
        target_id=tc.id, target_name=tc.table_name,
        message=f"AI智能填充 {batch_no}，填充 {len(diff_rows)} 个单元格",
        operator=user.username if user else "system",
    )
    db.commit()

    return {
        "success": True,
        "task_id": task_log.id,
        "import_batch_no": batch_no,
        "fill_count": len(diff_rows),
        "affected_rows": len(affected_pk_keys),
    }


def _get_alias(field_name: str, fields_list: list[dict]) -> str:
    for f in fields_list:
        if f["field_name"] == field_name:
            return f.get("field_alias") or field_name
    return field_name
