"""SQL Console — 轻量 SQL 控制台 (只允许 SELECT)"""

import io
import re
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import DatasourceConfig, UserAccount
from app.utils.auth import get_current_user, require_role
from app.utils.crypto import decrypt_password
from app.utils.remote_db import _connect
from app.utils.audit import log_operation

router = APIRouter(prefix="/api/sql-console", tags=["sql-console"])

# Dangerous keywords to block
BLOCKED_KEYWORDS = re.compile(
    r'\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE|MERGE|REPLACE|CALL|INTO)\b',
    re.IGNORECASE,
)

# Allow only SELECT (and WITH for CTEs)
ALLOWED_START = re.compile(r'^\s*(SELECT|WITH|EXPLAIN|SHOW|DESCRIBE|DESC)\b', re.IGNORECASE)


def _validate_sql(sql: str):
    """Validate SQL is safe (SELECT only)."""
    cleaned = sql.strip().rstrip(";").strip()
    if not cleaned:
        raise HTTPException(400, "SQL 不能为空")
    if not ALLOWED_START.match(cleaned):
        raise HTTPException(400, "只允许 SELECT / EXPLAIN / SHOW 查询")
    if BLOCKED_KEYWORDS.search(cleaned):
        raise HTTPException(400, "检测到危险关键字，只允许 SELECT 查询")
    # Check for multiple statements
    # Simple heuristic: split by ; and check
    parts = [p.strip() for p in cleaned.split(";") if p.strip()]
    if len(parts) > 1:
        raise HTTPException(400, "不允许执行多条 SQL 语句")
    return cleaned


class ExecuteRequest(BaseModel):
    datasource_id: int
    sql: str
    max_rows: int = 1000
    schema_name: Optional[str] = None


@router.post("/execute")
def execute_sql(
    body: ExecuteRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """Execute a SELECT query on the specified datasource."""
    sql = _validate_sql(body.sql)

    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == body.datasource_id, DatasourceConfig.is_deleted == 0
    ).first()
    if not ds:
        raise HTTPException(404, "数据源不存在")

    pwd = decrypt_password(ds.password_encrypted)
    conn = _connect(ds.db_type, ds.host, ds.port, ds.username, pwd,
                    ds.database_name, body.schema_name, ds.charset, ds.connect_timeout_seconds or 10)
    try:
        cur = conn.cursor()
        cur.execute(sql)

        # Get column names
        columns = []
        if cur.description:
            columns = [desc[0] for desc in cur.description]

        rows = cur.fetchmany(body.max_rows)
        # Convert to list of lists (string values)
        data = []
        for row in rows:
            data.append([str(v) if v is not None else "" for v in row])

        total_available = len(data)
        if len(data) >= body.max_rows:
            # There might be more rows
            try:
                extra = cur.fetchone()
                if extra:
                    total_available = body.max_rows + 1  # Indicate truncation
            except Exception:
                pass

    except Exception as e:
        raise HTTPException(400, f"SQL 执行失败: {str(e)}")
    finally:
        conn.close()

    log_operation(db, "SQL控制台", "执行查询", "success",
                  message=f"查询返回 {len(data)} 行, SQL: {sql[:100]}",
                  operator=user.username)

    return {
        "columns": columns,
        "rows": data,
        "row_count": len(data),
        "truncated": total_available > body.max_rows,
    }


class ExportRequest(BaseModel):
    datasource_id: int
    sql: str
    max_rows: int = 50000
    schema_name: Optional[str] = None


@router.post("/export")
def export_query_result(
    body: ExportRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """Export query result as Excel."""
    sql = _validate_sql(body.sql)

    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == body.datasource_id, DatasourceConfig.is_deleted == 0
    ).first()
    if not ds:
        raise HTTPException(404, "数据源不存在")

    pwd = decrypt_password(ds.password_encrypted)
    conn = _connect(ds.db_type, ds.host, ds.port, ds.username, pwd,
                    ds.database_name, body.schema_name, ds.charset, ds.connect_timeout_seconds or 10)
    try:
        cur = conn.cursor()
        cur.execute(sql)
        columns = [desc[0] for desc in cur.description] if cur.description else []
        rows = cur.fetchmany(body.max_rows)
    except Exception as e:
        raise HTTPException(400, f"SQL 执行失败: {str(e)}")
    finally:
        conn.close()

    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Query Result"

    for ci, col in enumerate(columns, 1):
        ws.cell(row=1, column=ci, value=col)

    for ri, row in enumerate(rows, 2):
        for ci, val in enumerate(row, 1):
            ws.cell(row=ri, column=ci, value=str(val) if val is not None else "")

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    log_operation(db, "SQL控制台", "导出查询结果", "success",
                  message=f"导出 {len(rows)} 行",
                  operator=user.username)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=query_result.xlsx"},
    )
