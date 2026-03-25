"""DB Table Manager — view/create/alter/drop tables with SQL generation (v3.2)."""

from __future__ import annotations

import json
import os
import shutil
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.database import get_db, DATA_DIR
from app.models import DatasourceConfig, UserAccount, _now_bjt
from app.utils.auth import get_current_user, require_role
from app.utils.crypto import decrypt_password
from app.utils.remote_db import _connect
from app.utils.audit import log_operation
from app.i18n import t

router = APIRouter(prefix="/api/db-manager", tags=["库表管理"])

_BJT = timezone(timedelta(hours=8))
BACKUP_DIR = os.path.join(DATA_DIR, "db_manager_backups")
os.makedirs(BACKUP_DIR, exist_ok=True)


# ── Schemas ──

class ColumnDef(BaseModel):
    name: str
    type: str
    is_primary_key: bool = False
    is_nullable: bool = True
    default_value: Optional[str] = None
    comment: Optional[str] = None


class CreateTableRequest(BaseModel):
    datasource_id: int
    table_name: str
    columns: List[ColumnDef]
    comment: Optional[str] = None
    execute: bool = False  # False = preview SQL only; True = execute


class AddColumnRequest(BaseModel):
    datasource_id: int
    table_name: str
    column: ColumnDef
    after_column: Optional[str] = None
    execute: bool = False


class DropColumnRequest(BaseModel):
    datasource_id: int
    table_name: str
    column_name: str
    execute: bool = False


class ModifyColumnRequest(BaseModel):
    datasource_id: int
    table_name: str
    column_name: str
    new_type: Optional[str] = None
    new_name: Optional[str] = None
    new_default: Optional[str] = None
    new_comment: Optional[str] = None
    is_nullable: Optional[bool] = None
    execute: bool = False


class DropTableRequest(BaseModel):
    datasource_id: int
    table_name: str
    confirm: bool = False
    backup_first: bool = True


# ── Helper ──

def _get_connection(ds: DatasourceConfig):
    """Get a raw DB connection from a datasource config."""
    password = decrypt_password(ds.password_encrypted)
    return _connect(ds.db_type, ds.host, ds.port, ds.username, password,
                    ds.database_name, ds.schema_name, ds.charset or "utf8")


def _quote_ident(name: str, db_type: str) -> str:
    """Quote an identifier based on DB type."""
    if db_type == "mysql":
        return f"`{name}`"
    elif db_type == "sqlserver":
        return f"[{name}]"
    return f'"{name}"'


# ── GET /api/db-manager/tables ── List all tables in a datasource

@router.get("/tables")
def list_tables(
    datasource_id: int = Query(...),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """List all tables in the given datasource."""
    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == datasource_id,
        DatasourceConfig.is_deleted == 0,
    ).first()
    if not ds:
        raise HTTPException(404, "数据源不存在")

    conn = _get_connection(ds)
    try:
        cursor = conn.cursor()
        if ds.db_type == "mysql":
            cursor.execute("SHOW TABLES")
            tables = [row[0] for row in cursor.fetchall()]
        elif ds.db_type == "postgresql":
            schema = ds.schema_name or "public"
            cursor.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = %s ORDER BY table_name",
                (schema,),
            )
            tables = [row[0] for row in cursor.fetchall()]
        elif ds.db_type == "sqlserver":
            schema = ds.schema_name or "dbo"
            cursor.execute(
                "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
                (schema,),
            )
            tables = [row[0] for row in cursor.fetchall()]
        else:
            tables = []
        return {"tables": tables, "count": len(tables)}
    finally:
        conn.close()


# ── GET /api/db-manager/table-structure ── View table structure

@router.get("/table-structure")
def get_table_structure(
    datasource_id: int = Query(...),
    table_name: str = Query(...),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """Get columns, primary keys, and indexes for a table."""
    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == datasource_id,
        DatasourceConfig.is_deleted == 0,
    ).first()
    if not ds:
        raise HTTPException(404, "数据源不存在")

    conn = _get_connection(ds)
    try:
        cursor = conn.cursor()
        columns = []
        primary_keys = []
        indexes = []

        if ds.db_type == "mysql":
            cursor.execute(f"DESCRIBE `{table_name}`")
            for row in cursor.fetchall():
                columns.append({
                    "name": row[0],
                    "type": row[1],
                    "is_nullable": row[2] == "YES",
                    "default_value": row[4] if len(row) > 4 else None,
                    "is_primary_key": row[3] == "PRI" if len(row) > 3 else False,
                    "extra": row[5] if len(row) > 5 else None,
                })
                if len(row) > 3 and row[3] == "PRI":
                    primary_keys.append(row[0])

            # Indexes
            cursor.execute(f"SHOW INDEX FROM `{table_name}`")
            idx_rows = cursor.fetchall()
            idx_map: Dict[str, Any] = {}
            for irow in idx_rows:
                idx_name = irow[2]
                if idx_name not in idx_map:
                    idx_map[idx_name] = {
                        "name": idx_name,
                        "unique": not irow[1],
                        "columns": [],
                    }
                idx_map[idx_name]["columns"].append(irow[4])
            indexes = list(idx_map.values())

            # Table comment
            cursor.execute(
                f"SELECT TABLE_COMMENT FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '{table_name}'"
            )
            comment_row = cursor.fetchone()
            table_comment = comment_row[0] if comment_row else None

        elif ds.db_type == "postgresql":
            schema = ds.schema_name or "public"
            cursor.execute(
                """SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
                          col_description((table_schema||'.'||table_name)::regclass, c.ordinal_position) as col_comment
                   FROM information_schema.columns c
                   WHERE c.table_schema = %s AND c.table_name = %s
                   ORDER BY c.ordinal_position""",
                (schema, table_name),
            )
            for row in cursor.fetchall():
                columns.append({
                    "name": row[0],
                    "type": row[1],
                    "is_nullable": row[2] == "YES",
                    "default_value": row[3],
                    "comment": row[4] if len(row) > 4 else None,
                })

            # Primary keys
            cursor.execute(
                """SELECT kcu.column_name
                   FROM information_schema.table_constraints tc
                   JOIN information_schema.key_column_usage kcu
                     ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                   WHERE tc.table_schema = %s AND tc.table_name = %s AND tc.constraint_type = 'PRIMARY KEY'""",
                (schema, table_name),
            )
            primary_keys = [r[0] for r in cursor.fetchall()]
            for col in columns:
                col["is_primary_key"] = col["name"] in primary_keys

            table_comment = None
            cursor.execute(
                f"SELECT obj_description('{schema}.{table_name}'::regclass)"
            )
            cr = cursor.fetchone()
            if cr:
                table_comment = cr[0]
        else:
            table_comment = None

        return {
            "table_name": table_name,
            "table_comment": table_comment,
            "columns": columns,
            "primary_keys": primary_keys,
            "indexes": indexes,
        }
    finally:
        conn.close()


# ── POST /api/db-manager/create-table ── Generate & optionally execute CREATE TABLE

@router.post("/create-table")
def create_table(
    req: CreateTableRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == req.datasource_id,
        DatasourceConfig.is_deleted == 0,
    ).first()
    if not ds:
        raise HTTPException(404, "数据源不存在")

    q = _quote_ident
    col_defs = []
    pk_cols = []

    for col in req.columns:
        parts = [f"  {q(col.name, ds.db_type)} {col.type}"]
        if not col.is_nullable:
            parts.append("NOT NULL")
        if col.default_value is not None:
            parts.append(f"DEFAULT {col.default_value}")
        if col.comment and ds.db_type == "mysql":
            parts.append(f"COMMENT '{col.comment}'")
        col_defs.append(" ".join(parts))
        if col.is_primary_key:
            pk_cols.append(q(col.name, ds.db_type))

    if pk_cols:
        col_defs.append(f"  PRIMARY KEY ({', '.join(pk_cols)})")

    tbl_q = q(req.table_name, ds.db_type)
    sql = f"CREATE TABLE {tbl_q} (\n" + ",\n".join(col_defs) + "\n)"

    if ds.db_type == "mysql" and req.comment:
        sql += f" COMMENT='{req.comment}'"

    sql += ";"

    # For PostgreSQL, add table and column comments separately
    comment_sqls = []
    if ds.db_type == "postgresql":
        if req.comment:
            comment_sqls.append(f"COMMENT ON TABLE {tbl_q} IS '{req.comment}';")
        for col in req.columns:
            if col.comment:
                comment_sqls.append(f"COMMENT ON COLUMN {tbl_q}.{q(col.name, ds.db_type)} IS '{col.comment}';")

    full_sql = sql
    if comment_sqls:
        full_sql += "\n" + "\n".join(comment_sqls)

    result = {"sql": full_sql, "executed": False}

    if req.execute:
        conn = _get_connection(ds)
        try:
            cursor = conn.cursor()
            cursor.execute(sql)
            for cs in comment_sqls:
                cursor.execute(cs)
            conn.commit()
            result["executed"] = True
            result["message"] = f"表 {req.table_name} 创建成功"
            log_operation(db, "库表管理", "建表", "success",
                          target_name=req.table_name,
                          message=f"在数据源 {ds.datasource_name} 创建表 {req.table_name}",
                          operator=user.username)
            db.commit()
        except Exception as e:
            result["error"] = str(e)
            result["executed"] = False
        finally:
            conn.close()

    return result


# ── POST /api/db-manager/add-column ──

@router.post("/add-column")
def add_column(
    req: AddColumnRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == req.datasource_id,
        DatasourceConfig.is_deleted == 0,
    ).first()
    if not ds:
        raise HTTPException(404, "数据源不存在")

    q = _quote_ident
    col = req.column
    parts = [f"ADD COLUMN {q(col.name, ds.db_type)} {col.type}"]
    if not col.is_nullable:
        parts.append("NOT NULL")
    if col.default_value is not None:
        parts.append(f"DEFAULT {col.default_value}")
    if col.comment and ds.db_type == "mysql":
        parts.append(f"COMMENT '{col.comment}'")
    if req.after_column and ds.db_type == "mysql":
        parts.append(f"AFTER {q(req.after_column, ds.db_type)}")

    sql = f"ALTER TABLE {q(req.table_name, ds.db_type)} {' '.join(parts)};"

    comment_sql = None
    if col.comment and ds.db_type == "postgresql":
        comment_sql = f"COMMENT ON COLUMN {q(req.table_name, ds.db_type)}.{q(col.name, ds.db_type)} IS '{col.comment}';"

    full_sql = sql
    if comment_sql:
        full_sql += "\n" + comment_sql

    result = {"sql": full_sql, "executed": False}

    if req.execute:
        conn = _get_connection(ds)
        try:
            cursor = conn.cursor()
            cursor.execute(sql)
            if comment_sql:
                cursor.execute(comment_sql)
            conn.commit()
            result["executed"] = True
            result["message"] = f"字段 {col.name} 添加成功"
            log_operation(db, "库表管理", "加字段", "success",
                          target_name=f"{req.table_name}.{col.name}",
                          message=f"在表 {req.table_name} 添加字段 {col.name}",
                          operator=user.username)
            db.commit()
        except Exception as e:
            result["error"] = str(e)
        finally:
            conn.close()

    return result


# ── POST /api/db-manager/drop-column ──

@router.post("/drop-column")
def drop_column(
    req: DropColumnRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == req.datasource_id,
        DatasourceConfig.is_deleted == 0,
    ).first()
    if not ds:
        raise HTTPException(404, "数据源不存在")

    q = _quote_ident
    sql = f"ALTER TABLE {q(req.table_name, ds.db_type)} DROP COLUMN {q(req.column_name, ds.db_type)};"

    result = {"sql": sql, "executed": False}

    if req.execute:
        conn = _get_connection(ds)
        try:
            cursor = conn.cursor()
            cursor.execute(sql)
            conn.commit()
            result["executed"] = True
            result["message"] = f"字段 {req.column_name} 已删除"
            log_operation(db, "库表管理", "删字段", "success",
                          target_name=f"{req.table_name}.{req.column_name}",
                          message=f"从表 {req.table_name} 删除字段 {req.column_name}",
                          operator=user.username)
            db.commit()
        except Exception as e:
            result["error"] = str(e)
        finally:
            conn.close()

    return result


# ── POST /api/db-manager/modify-column ──

@router.post("/modify-column")
def modify_column(
    req: ModifyColumnRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == req.datasource_id,
        DatasourceConfig.is_deleted == 0,
    ).first()
    if not ds:
        raise HTTPException(404, "数据源不存在")

    q = _quote_ident
    sqls = []

    if ds.db_type == "mysql":
        if req.new_name and req.new_name != req.column_name:
            # RENAME
            new_type = req.new_type or "VARCHAR(255)"
            sqls.append(
                f"ALTER TABLE {q(req.table_name, ds.db_type)} CHANGE COLUMN {q(req.column_name, ds.db_type)} {q(req.new_name, ds.db_type)} {new_type};"
            )
        elif req.new_type:
            sqls.append(
                f"ALTER TABLE {q(req.table_name, ds.db_type)} MODIFY COLUMN {q(req.column_name, ds.db_type)} {req.new_type};"
            )
        if req.new_comment:
            col_name = req.new_name or req.column_name
            col_type = req.new_type or "VARCHAR(255)"
            sqls.append(
                f"ALTER TABLE {q(req.table_name, ds.db_type)} MODIFY COLUMN {q(col_name, ds.db_type)} {col_type} COMMENT '{req.new_comment}';"
            )

    elif ds.db_type == "postgresql":
        if req.new_type:
            sqls.append(
                f"ALTER TABLE {q(req.table_name, ds.db_type)} ALTER COLUMN {q(req.column_name, ds.db_type)} TYPE {req.new_type};"
            )
        if req.new_name and req.new_name != req.column_name:
            sqls.append(
                f"ALTER TABLE {q(req.table_name, ds.db_type)} RENAME COLUMN {q(req.column_name, ds.db_type)} TO {q(req.new_name, ds.db_type)};"
            )
        if req.new_default is not None:
            col_name = req.new_name or req.column_name
            sqls.append(
                f"ALTER TABLE {q(req.table_name, ds.db_type)} ALTER COLUMN {q(col_name, ds.db_type)} SET DEFAULT {req.new_default};"
            )
        if req.new_comment:
            col_name = req.new_name or req.column_name
            sqls.append(
                f"COMMENT ON COLUMN {q(req.table_name, ds.db_type)}.{q(col_name, ds.db_type)} IS '{req.new_comment}';"
            )

    full_sql = "\n".join(sqls) if sqls else "-- No changes specified"

    result = {"sql": full_sql, "executed": False}

    if req.execute and sqls:
        conn = _get_connection(ds)
        try:
            cursor = conn.cursor()
            for s in sqls:
                cursor.execute(s)
            conn.commit()
            result["executed"] = True
            result["message"] = f"字段 {req.column_name} 修改成功"
            log_operation(db, "库表管理", "改字段", "success",
                          target_name=f"{req.table_name}.{req.column_name}",
                          message=f"修改表 {req.table_name} 字段 {req.column_name}",
                          operator=user.username)
            db.commit()
        except Exception as e:
            result["error"] = str(e)
        finally:
            conn.close()

    return result


# ── POST /api/db-manager/drop-table ──

@router.post("/drop-table")
def drop_table(
    req: DropTableRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    if not req.confirm:
        raise HTTPException(400, "请确认删除操作（confirm=true）")

    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == req.datasource_id,
        DatasourceConfig.is_deleted == 0,
    ).first()
    if not ds:
        raise HTTPException(404, "数据源不存在")

    q = _quote_ident

    # Backup first
    backup_info = None
    if req.backup_first:
        try:
            conn = _get_connection(ds)
            cursor = conn.cursor()
            backup_name = f"{req.table_name}_bak_{datetime.now(_BJT).strftime('%Y%m%d%H%M%S')}"
            if ds.db_type == "mysql":
                cursor.execute(f"CREATE TABLE {q(backup_name, ds.db_type)} AS SELECT * FROM {q(req.table_name, ds.db_type)}")
            elif ds.db_type == "postgresql":
                cursor.execute(f"CREATE TABLE {q(backup_name, ds.db_type)} AS SELECT * FROM {q(req.table_name, ds.db_type)}")
            conn.commit()
            backup_info = {"backup_table": backup_name}
            conn.close()
        except Exception as e:
            backup_info = {"backup_error": str(e)}

    sql = f"DROP TABLE {q(req.table_name, ds.db_type)};"

    conn = _get_connection(ds)
    try:
        cursor = conn.cursor()
        cursor.execute(sql)
        conn.commit()
        log_operation(db, "库表管理", "删表", "success",
                      target_name=req.table_name,
                      message=f"删除数据源 {ds.datasource_name} 的表 {req.table_name}",
                      operator=user.username)
        db.commit()
        return {
            "sql": sql,
            "executed": True,
            "message": f"表 {req.table_name} 已删除",
            "backup": backup_info,
        }
    except Exception as e:
        raise HTTPException(500, f"删除失败: {str(e)}")
    finally:
        conn.close()
