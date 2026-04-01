"""AI Natural Language Query API — POST /api/ai/nl-query + /api/ai/nl-query/execute"""

import json
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import TableConfig, FieldConfig, DatasourceConfig
from app.utils.auth import get_current_user
from app.utils.crypto import decrypt_password
from app.utils.remote_db import _connect
from app.utils.sql_security import check_sql_injection
from app.ai.ai_engine import AIEngine
from app.ai.nl_query_engine import parse_nl_query_rules, parse_nl_query_llm
from app.i18n import t

router = APIRouter(prefix="/api/ai", tags=["AI NL Query"])


# ── Schemas ──

class FieldContext(BaseModel):
    name: str
    display_name: Optional[str] = None
    type: Optional[str] = None
    enum_values: Optional[List[str]] = None


class NLQueryRequest(BaseModel):
    table_id: int
    query_text: str
    context: Optional[dict] = None  # { fields: [...], previous_filters: [...] }


class NLQueryExecuteRequest(BaseModel):
    table_id: int
    filters: List[dict]
    sql_preview: Optional[str] = None
    page: int = 1
    page_size: int = 50


class NLQueryFilter(BaseModel):
    field: str
    operator: str
    value: Optional[object] = None
    display: str


class NLQueryResponse(BaseModel):
    filters: List[dict]
    explanation: str
    confidence: float
    sql_preview: Optional[str] = None
    engine: Optional[str] = None


# ── Helpers ──

def _build_field_context(db: Session, table_config_id: int) -> list[dict]:
    """Build field context list from DB for a managed table."""
    fields = (
        db.query(FieldConfig)
        .filter(FieldConfig.table_config_id == table_config_id, FieldConfig.is_deleted == 0)
        .order_by(FieldConfig.field_order_no)
        .all()
    )
    result = []
    for f in fields:
        if not f.is_displayed:
            continue
        enum_vals = []
        if f.enum_options_json:
            try:
                enum_vals = json.loads(f.enum_options_json)
                if not isinstance(enum_vals, list):
                    enum_vals = []
            except (json.JSONDecodeError, TypeError):
                enum_vals = []

        result.append({
            "name": f.field_name,
            "display_name": f.field_alias or f.field_name,
            "type": f.db_data_type or "VARCHAR",
            "enum_values": enum_vals,
        })
    return result


# ── SQL Preview Builder ──

_OP_SQL_MAP = {
    "eq": "=",
    "neq": "!=",
    "gt": ">",
    "gte": ">=",
    "lt": "<",
    "lte": "<=",
    "like": "LIKE",
    "not_like": "NOT LIKE",
    "is_null": "IS NULL",
    "is_not_null": "IS NOT NULL",
    "in": "IN",
    "not_in": "NOT IN",
    "between": "BETWEEN",
}


def _build_sql_preview(table_name: str, filters: list[dict]) -> str:
    """Generate a read-only SQL preview from structured filters."""
    if not filters:
        return f"SELECT * FROM {table_name}"

    where_clauses = []
    for f in filters:
        field = f.get("field", "?")
        op = f.get("operator", "eq")
        val = f.get("value")
        sql_op = _OP_SQL_MAP.get(op, "=")

        if op in ("is_null", "is_not_null"):
            where_clauses.append(f"{field} {sql_op}")
        elif op == "like":
            where_clauses.append(f"{field} LIKE '%{val}%'")
        elif op == "not_like":
            where_clauses.append(f"{field} NOT LIKE '%{val}%'")
        elif op == "in" and isinstance(val, list):
            vals = ", ".join(f"'{v}'" for v in val)
            where_clauses.append(f"{field} IN ({vals})")
        elif op == "not_in" and isinstance(val, list):
            vals = ", ".join(f"'{v}'" for v in val)
            where_clauses.append(f"{field} NOT IN ({vals})")
        elif op == "between" and isinstance(val, list) and len(val) == 2:
            where_clauses.append(f"{field} BETWEEN '{val[0]}' AND '{val[1]}'")
        elif isinstance(val, (int, float)):
            where_clauses.append(f"{field} {sql_op} {val}")
        else:
            where_clauses.append(f"{field} {sql_op} '{val}'")

    where_str = " AND ".join(where_clauses)
    return f"SELECT * FROM {table_name} WHERE {where_str}"


def _get_table_and_ds(db: Session, table_id: int):
    """Get table config and datasource, raise 404 if missing."""
    tc = db.query(TableConfig).filter(
        TableConfig.id == table_id,
        TableConfig.is_deleted == 0,
        TableConfig.status == "enabled",
    ).first()
    if not tc:
        raise HTTPException(404, t("ai_nl_query.table_not_found"))
    ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == tc.datasource_id).first()
    if not ds:
        raise HTTPException(404, t("ai_nl_query.datasource_not_found"))
    return tc, ds


# ── Endpoint: Parse ──

@router.post("/nl-query")
async def nl_query(
    body: NLQueryRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Parse natural language query into structured filter conditions + SQL preview."""
    tc, ds = _get_table_and_ds(db, body.table_id)

    query_text = (body.query_text or "").strip()
    if not query_text:
        raise HTTPException(400, t("ai_nl_query.empty_query"))

    # Build field context — prefer request context, fallback to DB
    if body.context and body.context.get("fields"):
        fields_ctx = body.context["fields"]
    else:
        fields_ctx = _build_field_context(db, body.table_id)

    previous_filters = []
    if body.context and body.context.get("previous_filters"):
        previous_filters = body.context["previous_filters"]

    # Check AI engine config
    engine = AIEngine(db)

    if not engine.is_enabled or not engine.is_feature_enabled("nl_query"):
        result = parse_nl_query_rules(query_text, fields_ctx, previous_filters)
    else:
        llm_client = engine.get_llm_client()
        if llm_client:
            result = await parse_nl_query_llm(query_text, fields_ctx, previous_filters, llm_client)
        else:
            result = parse_nl_query_rules(query_text, fields_ctx, previous_filters)

    # If rules engine returned nothing useful, provide friendly message
    if not result.get("filters") and result.get("confidence", 0) == 0:
        result["explanation"] = t("ai_nl_query.parse_hint")

    # Generate SQL preview
    result["sql_preview"] = _build_sql_preview(tc.table_name, result.get("filters", []))

    return {"success": True, "data": result}


# ── Endpoint: Execute confirmed query ──

@router.post("/nl-query/execute")
async def nl_query_execute(
    body: NLQueryExecuteRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Execute a confirmed NL query — read-only SELECT with structured filters."""
    tc, ds = _get_table_and_ds(db, body.table_id)
    pwd = decrypt_password(ds.password_encrypted)

    # Get displayed fields
    fields = (
        db.query(FieldConfig)
        .filter(FieldConfig.table_config_id == tc.id, FieldConfig.is_deleted == 0, FieldConfig.is_displayed == True)
        .order_by(FieldConfig.field_order_no)
        .all()
    )
    if not fields:
        return {"success": True, "data": {"columns": [], "rows": [], "total": 0}}

    valid_field_names = {f.field_name for f in fields}
    col_names = [f.field_name for f in fields]

    # Build safe WHERE from filters
    _OP_SET = {"eq", "neq", "gt", "gte", "lt", "lte", "like", "not_like", "is_null", "is_not_null", "in", "not_in", "between"}
    where_parts = []
    params = []

    def _ph(db_type: str) -> str:
        return "%s" if db_type == "mysql" else "?"

    ph = _ph(ds.db_type)

    for sf in body.filters:
        fname = sf.get("field", "")
        op = sf.get("operator", "")
        val = sf.get("value")

        if fname not in valid_field_names or op not in _OP_SET:
            continue
        if val is not None and check_sql_injection(str(val)):
            continue

        col = f"`{fname}`" if ds.db_type == "mysql" else f'"{fname}"'

        if op == "eq":
            where_parts.append(f"{col} = {ph}")
            params.append(val)
        elif op == "neq":
            where_parts.append(f"{col} != {ph}")
            params.append(val)
        elif op == "gt":
            where_parts.append(f"{col} > {ph}")
            params.append(val)
        elif op == "gte":
            where_parts.append(f"{col} >= {ph}")
            params.append(val)
        elif op == "lt":
            where_parts.append(f"{col} < {ph}")
            params.append(val)
        elif op == "lte":
            where_parts.append(f"{col} <= {ph}")
            params.append(val)
        elif op == "like":
            where_parts.append(f"CAST({col} AS CHAR) LIKE {ph}")
            params.append(f"%{val}%")
        elif op == "not_like":
            where_parts.append(f"CAST({col} AS CHAR) NOT LIKE {ph}")
            params.append(f"%{val}%")
        elif op == "is_null":
            where_parts.append(f"{col} IS NULL")
        elif op == "is_not_null":
            where_parts.append(f"{col} IS NOT NULL")
        elif op == "in" and isinstance(val, list):
            placeholders = ", ".join([ph] * len(val))
            where_parts.append(f"{col} IN ({placeholders})")
            params.extend(val)
        elif op == "not_in" and isinstance(val, list):
            placeholders = ", ".join([ph] * len(val))
            where_parts.append(f"{col} NOT IN ({placeholders})")
            params.extend(val)
        elif op == "between" and isinstance(val, list) and len(val) == 2:
            where_parts.append(f"{col} BETWEEN {ph} AND {ph}")
            params.extend(val)

    # Build qualified table name
    if ds.db_type == "mysql":
        qt = f"`{tc.table_name}`"
    else:
        qt = f'"{tc.table_name}"'
    if tc.schema_name and ds.db_type in ("postgresql", "oracle", "sqlserver"):
        qt = f'"{tc.schema_name}".{qt}'

    # Build SELECT columns
    if ds.db_type == "mysql":
        select_cols = ", ".join(f"`{c}`" for c in col_names)
    else:
        select_cols = ", ".join(f'"{c}"' for c in col_names)

    where_clause = " AND ".join(where_parts) if where_parts else "1=1"

    # Count query
    count_sql = f"SELECT COUNT(*) FROM {qt} WHERE {where_clause}"
    # Data query with pagination
    offset = (body.page - 1) * body.page_size
    data_sql = f"SELECT {select_cols} FROM {qt} WHERE {where_clause} LIMIT {body.page_size} OFFSET {offset}"

    conn = _connect(
        ds.db_type, ds.host, ds.port, ds.username, pwd,
        tc.db_name, tc.schema_name, ds.charset, ds.connect_timeout_seconds or 10,
    )
    try:
        cur = conn.cursor()

        # Get total count
        cur.execute(count_sql, params)
        total = cur.fetchone()[0]

        # Get data rows
        cur.execute(data_sql, params)
        raw_rows = cur.fetchall()
        desc = [d[0] for d in cur.description] if cur.description else col_names

        rows = []
        for row in raw_rows:
            row_dict = {}
            for i, col_name in enumerate(desc):
                v = row[i] if i < len(row) else None
                row_dict[col_name] = str(v) if v is not None else None
            rows.append(row_dict)

        columns = []
        for f in fields:
            columns.append({
                "field_name": f.field_name,
                "field_alias": f.field_alias or f.field_name,
                "db_data_type": f.db_data_type,
            })

        return {
            "success": True,
            "data": {
                "columns": columns,
                "rows": rows,
                "total": total,
                "page": body.page,
                "page_size": body.page_size,
            },
        }
    except Exception as e:
        raise HTTPException(500, t("ai_nl_query.execute_failed", error=str(e)))
    finally:
        try:
            conn.close()
        except Exception:
            pass
