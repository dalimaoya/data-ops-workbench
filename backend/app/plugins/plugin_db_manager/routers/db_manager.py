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


class CreateIndexRequest(BaseModel):
    datasource_id: int
    table_name: str
    index_name: str
    columns: List[str]
    unique: bool = False
    execute: bool = False


class DropIndexRequest(BaseModel):
    datasource_id: int
    table_name: str
    index_name: str
    execute: bool = False


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


def _get_schema_or_owner(ds: DatasourceConfig) -> str:
    """Get the effective schema/owner for a datasource."""
    if ds.db_type == "oracle":
        return (ds.schema_name or ds.username or "").upper()
    if ds.db_type == "dm":
        return (ds.schema_name or ds.username or "").upper()
    if ds.db_type == "kingbase":
        return ds.schema_name or "public"
    if ds.db_type == "postgresql":
        return ds.schema_name or "public"
    if ds.db_type == "sqlserver":
        return ds.schema_name or "dbo"
    return ""


# ── GET /api/db-manager/tables ── List all tables in a datasource

@router.get("/tables")
def list_tables(
    datasource_id: int = Query(...),
    keyword: str = Query("", description="Filter tables by name (case-insensitive)"),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """List all tables in the given datasource with optional keyword filter and row count estimates."""
    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == datasource_id,
        DatasourceConfig.is_deleted == 0,
    ).first()
    if not ds:
        raise HTTPException(404, "数据源不存在")

    conn = _get_connection(ds)
    try:
        cursor = conn.cursor()
        table_rows: list = []  # list of (table_name, comment, row_estimate)

        if ds.db_type == "mysql":
            cursor.execute(
                "SELECT TABLE_NAME, TABLE_COMMENT, TABLE_ROWS "
                "FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' "
                "ORDER BY TABLE_NAME"
            )
            table_rows = [(r[0], r[1], r[2]) for r in cursor.fetchall()]

        elif ds.db_type in ("postgresql", "kingbase"):
            schema = _get_schema_or_owner(ds)
            cursor.execute("""
                SELECT c.relname, obj_description(c.oid), c.reltuples::bigint
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = %s AND c.relkind = 'r'
                ORDER BY c.relname
            """, (schema,))
            table_rows = [(r[0], r[1], r[2] if r[2] and r[2] >= 0 else None) for r in cursor.fetchall()]

        elif ds.db_type == "sqlserver":
            schema = _get_schema_or_owner(ds)
            cursor.execute("""
                SELECT t.name,
                       CAST(ep.value AS NVARCHAR(MAX)),
                       SUM(p.rows)
                FROM sys.tables t
                LEFT JOIN sys.extended_properties ep
                    ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
                LEFT JOIN sys.schemas s ON s.schema_id = t.schema_id
                LEFT JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
                WHERE s.name = ?
                GROUP BY t.name, ep.value
                ORDER BY t.name
            """, (schema,))
            table_rows = [(r[0], r[1], r[2]) for r in cursor.fetchall()]

        elif ds.db_type == "oracle":
            owner = _get_schema_or_owner(ds)
            cursor.execute("""
                SELECT tc.table_name, tc.comments, t.num_rows
                FROM all_tab_comments tc
                LEFT JOIN all_tables t ON t.owner = tc.owner AND t.table_name = tc.table_name
                WHERE tc.owner = :1 AND tc.table_type = 'TABLE'
                ORDER BY tc.table_name
            """, (owner,))
            table_rows = [(r[0], r[1], r[2]) for r in cursor.fetchall()]

        elif ds.db_type == "dm":
            owner = _get_schema_or_owner(ds)
            try:
                cursor.execute("""
                    SELECT tc.TABLE_NAME, tc.COMMENTS, t.NUM_ROWS
                    FROM ALL_TAB_COMMENTS tc
                    LEFT JOIN ALL_TABLES t ON t.OWNER = tc.OWNER AND t.TABLE_NAME = tc.TABLE_NAME
                    WHERE tc.OWNER = ? AND tc.TABLE_TYPE = 'TABLE'
                    ORDER BY tc.TABLE_NAME
                """, (owner,))
                table_rows = [(r[0], r[1], r[2]) for r in cursor.fetchall()]
            except Exception:
                cursor.execute("SELECT TABLE_NAME, COMMENTS FROM ALL_TAB_COMMENTS WHERE OWNER = ? ORDER BY TABLE_NAME", (owner,))
                table_rows = [(r[0], r[1] if len(r) > 1 else None, None) for r in cursor.fetchall()]

        elif ds.db_type == "sqlite":
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            table_rows = [(r[0], None, None) for r in cursor.fetchall()]

        # Apply keyword filter
        kw = keyword.strip().lower()
        all_count = len(table_rows)
        if kw:
            table_rows = [r for r in table_rows if kw in (r[0] or "").lower() or kw in (r[1] or "").lower()]

        result = []
        for name, comment, row_est in table_rows:
            result.append({
                "table_name": name,
                "comment": comment,
                "row_count_estimate": row_est,
            })

        return {
            "tables": result,
            "total_count": all_count,
            "filtered_count": len(result),
        }
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
        elif ds.db_type == "sqlite":
            cursor.execute(f"PRAGMA table_info('{table_name}')")
            for row in cursor.fetchall():
                # row: (cid, name, type, notnull, dflt_value, pk)
                columns.append({
                    "name": row[1],
                    "type": row[2],
                    "is_nullable": not row[3],
                    "default_value": row[4],
                    "is_primary_key": bool(row[5]),
                })
                if row[5]:
                    primary_keys.append(row[1])

            cursor.execute(f"PRAGMA index_list('{table_name}')")
            for idx_row in cursor.fetchall():
                idx_name = idx_row[1]
                is_unique = bool(idx_row[2])
                cursor2 = conn.cursor()
                cursor2.execute(f"PRAGMA index_info('{idx_name}')")
                idx_cols = [r[2] for r in cursor2.fetchall()]
                indexes.append({"name": idx_name, "unique": is_unique, "columns": idx_cols})

            table_comment = None

        elif ds.db_type in ("oracle", "dm"):
            owner = _get_schema_or_owner(ds)
            param_style = ":1" if ds.db_type == "oracle" else "?"
            cursor.execute(f"""
                SELECT column_name, data_type, nullable, data_default, column_id
                FROM all_tab_columns
                WHERE owner = {param_style} AND table_name = {param_style}
                ORDER BY column_id
            """, (owner, table_name.upper()))
            for row in cursor.fetchall():
                columns.append({
                    "name": row[0],
                    "type": row[1],
                    "is_nullable": row[2] == "Y",
                    "default_value": str(row[3]).strip() if row[3] else None,
                    "is_primary_key": False,
                })
            # Comments
            cursor.execute(f"""
                SELECT column_name, comments
                FROM all_col_comments
                WHERE owner = {param_style} AND table_name = {param_style}
            """, (owner, table_name.upper()))
            comment_map = {r[0]: r[1] for r in cursor.fetchall()}
            for col in columns:
                col["comment"] = comment_map.get(col["name"])
            # Primary keys
            try:
                cursor.execute(f"""
                    SELECT cols.column_name
                    FROM all_constraints c
                    JOIN all_cons_columns cols ON cols.constraint_name = c.constraint_name AND cols.owner = c.owner
                    WHERE c.owner = {param_style} AND c.table_name = {param_style} AND c.constraint_type = 'P'
                    ORDER BY cols.position
                """, (owner, table_name.upper()))
                primary_keys = [r[0] for r in cursor.fetchall()]
                for col in columns:
                    col["is_primary_key"] = col["name"] in primary_keys
            except Exception:
                pass
            # Table comment
            cursor.execute(f"""
                SELECT comments FROM all_tab_comments
                WHERE owner = {param_style} AND table_name = {param_style}
            """, (owner, table_name.upper()))
            cr = cursor.fetchone()
            table_comment = cr[0] if cr else None

        elif ds.db_type == "kingbase":
            schema = _get_schema_or_owner(ds)
            cursor.execute("""
                SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
                       col_description((table_schema||'.'||table_name)::regclass, c.ordinal_position) as col_comment
                FROM information_schema.columns c
                WHERE c.table_schema = %s AND c.table_name = %s
                ORDER BY c.ordinal_position
            """, (schema, table_name))
            for row in cursor.fetchall():
                columns.append({
                    "name": row[0],
                    "type": row[1],
                    "is_nullable": row[2] == "YES",
                    "default_value": row[3],
                    "comment": row[4] if len(row) > 4 else None,
                })
            cursor.execute("""
                SELECT kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                WHERE tc.table_schema = %s AND tc.table_name = %s AND tc.constraint_type = 'PRIMARY KEY'
            """, (schema, table_name))
            primary_keys = [r[0] for r in cursor.fetchall()]
            for col in columns:
                col["is_primary_key"] = col["name"] in primary_keys
            cursor.execute(f"SELECT obj_description('{schema}.{table_name}'::regclass)")
            cr = cursor.fetchone()
            table_comment = cr[0] if cr else None

        elif ds.db_type == "sqlserver":
            schema = _get_schema_or_owner(ds)
            cursor.execute("""
                SELECT c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT
                FROM INFORMATION_SCHEMA.COLUMNS c
                WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ?
                ORDER BY c.ORDINAL_POSITION
            """, (schema, table_name))
            for row in cursor.fetchall():
                columns.append({
                    "name": row[0],
                    "type": row[1],
                    "is_nullable": row[2] == "YES",
                    "default_value": row[3],
                    "is_primary_key": False,
                })
            # Primary keys
            cursor.execute("""
                SELECT kcu.COLUMN_NAME
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                  ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
                WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
            """, (schema, table_name))
            primary_keys = [r[0] for r in cursor.fetchall()]
            for col in columns:
                col["is_primary_key"] = col["name"] in primary_keys
            # Indexes
            cursor.execute("""
                SELECT i.name, i.is_unique, i.is_primary_key, c.name
                FROM sys.indexes i
                JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                JOIN sys.tables t ON i.object_id = t.object_id
                JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE s.name = ? AND t.name = ?
                ORDER BY i.name, ic.key_ordinal
            """, (schema, table_name))
            idx_map_ss: Dict[str, Any] = {}
            for row in cursor.fetchall():
                idx_name = row[0]
                if idx_name not in idx_map_ss:
                    idx_map_ss[idx_name] = {"name": idx_name, "unique": bool(row[1]), "is_primary": bool(row[2]), "columns": []}
                idx_map_ss[idx_name]["columns"].append(row[3])
            indexes = list(idx_map_ss.values())
            # Table comment
            cursor.execute("""
                SELECT CAST(ep.value AS NVARCHAR(MAX))
                FROM sys.tables t
                JOIN sys.schemas s ON s.schema_id = t.schema_id
                LEFT JOIN sys.extended_properties ep
                  ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
                WHERE s.name = ? AND t.name = ?
            """, (schema, table_name))
            cr = cursor.fetchone()
            table_comment = cr[0] if cr else None
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

    # Check duplicate column names
    col_names = [col.name.strip().lower() for col in req.columns]
    dupes = [n for n in set(col_names) if col_names.count(n) > 1]
    if dupes:
        raise HTTPException(400, f"字段名重复：{', '.join(dupes)}")

    col_defs = []
    pk_cols = []

    for col in req.columns:
        parts = [f"  {q(col.name, ds.db_type)} {col.type}"]
        if not col.is_nullable:
            parts.append("NOT NULL")
        if col.default_value is not None and col.default_value != "":
            # Quote string defaults, leave numeric/NULL/function unquoted
            dv = col.default_value
            if dv.upper() not in ("NULL", "CURRENT_TIMESTAMP", "NOW()") and not dv.replace(".", "").replace("-", "").isdigit():
                dv = f"'{dv}'"
            parts.append(f"DEFAULT {dv}")
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
    if col.default_value is not None and col.default_value != "":
        dv = col.default_value
        if dv.upper() not in ("NULL", "CURRENT_TIMESTAMP", "NOW()") and not dv.replace(".", "").replace("-", "").isdigit():
            dv = f"'{dv}'"
        parts.append(f"DEFAULT {dv}")
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


# ── GET /api/db-manager/indexes ── List indexes for a table

@router.get("/indexes")
def list_indexes(
    datasource_id: int = Query(...),
    table_name: str = Query(...),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """List all indexes for a table."""
    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == datasource_id,
        DatasourceConfig.is_deleted == 0,
    ).first()
    if not ds:
        raise HTTPException(404, "数据源不存在")

    conn = _get_connection(ds)
    try:
        cursor = conn.cursor()
        indexes: List[Dict[str, Any]] = []

        if ds.db_type == "mysql":
            cursor.execute(f"SHOW INDEX FROM `{table_name}`")
            idx_map: Dict[str, Any] = {}
            for row in cursor.fetchall():
                idx_name = row[2]
                if idx_name not in idx_map:
                    idx_map[idx_name] = {
                        "name": idx_name,
                        "unique": not row[1],
                        "columns": [],
                        "is_primary": idx_name == "PRIMARY",
                    }
                idx_map[idx_name]["columns"].append(row[4])
            indexes = list(idx_map.values())

        elif ds.db_type == "postgresql":
            schema = ds.schema_name or "public"
            cursor.execute("""
                SELECT i.relname AS index_name,
                       ix.indisunique AS is_unique,
                       ix.indisprimary AS is_primary,
                       array_agg(a.attname ORDER BY x.n) AS columns
                FROM pg_index ix
                JOIN pg_class t ON t.oid = ix.indrelid
                JOIN pg_class i ON i.oid = ix.indexrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, n)
                JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
                WHERE n.nspname = %s AND t.relname = %s
                GROUP BY i.relname, ix.indisunique, ix.indisprimary
                ORDER BY i.relname
            """, (schema, table_name))
            for row in cursor.fetchall():
                cols = row[3] if isinstance(row[3], list) else [row[3]] if row[3] else []
                indexes.append({
                    "name": row[0],
                    "unique": bool(row[1]),
                    "is_primary": bool(row[2]),
                    "columns": cols,
                })

        elif ds.db_type == "sqlserver":
            schema = ds.schema_name or "dbo"
            cursor.execute("""
                SELECT i.name AS index_name,
                       i.is_unique,
                       i.is_primary_key,
                       c.name AS column_name
                FROM sys.indexes i
                JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                JOIN sys.tables t ON i.object_id = t.object_id
                JOIN sys.schemas s ON t.schema_id = s.schema_id
                WHERE s.name = ? AND t.name = ?
                ORDER BY i.name, ic.key_ordinal
            """, (schema, table_name))
            idx_map2: Dict[str, Any] = {}
            for row in cursor.fetchall():
                idx_name = row[0]
                if idx_name not in idx_map2:
                    idx_map2[idx_name] = {
                        "name": idx_name,
                        "unique": bool(row[1]),
                        "is_primary": bool(row[2]),
                        "columns": [],
                    }
                idx_map2[idx_name]["columns"].append(row[3])
            indexes = list(idx_map2.values())

        elif ds.db_type == "sqlite":
            cursor.execute(f"PRAGMA index_list('{table_name}')")
            for idx_row in cursor.fetchall():
                idx_name = idx_row[1]
                is_unique = bool(idx_row[2])
                cursor2 = conn.cursor()
                cursor2.execute(f"PRAGMA index_info('{idx_name}')")
                idx_cols = [r[2] for r in cursor2.fetchall()]
                indexes.append({
                    "name": idx_name,
                    "unique": is_unique,
                    "is_primary": False,
                    "columns": idx_cols,
                })

        return {"indexes": indexes, "table_name": table_name}
    finally:
        conn.close()


# ── POST /api/db-manager/create-index ── Create an index

@router.post("/create-index")
def create_index(
    req: CreateIndexRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == req.datasource_id,
        DatasourceConfig.is_deleted == 0,
    ).first()
    if not ds:
        raise HTTPException(404, "数据源不存在")

    if not req.columns:
        raise HTTPException(400, "请至少选择一个字段")

    q = _quote_ident
    unique_kw = "UNIQUE " if req.unique else ""
    col_list = ", ".join(q(c, ds.db_type) for c in req.columns)
    sql = f"CREATE {unique_kw}INDEX {q(req.index_name, ds.db_type)} ON {q(req.table_name, ds.db_type)} ({col_list});"

    result = {"sql": sql, "executed": False}

    if req.execute:
        conn = _get_connection(ds)
        try:
            cursor = conn.cursor()
            cursor.execute(sql)
            conn.commit()
            result["executed"] = True
            result["message"] = f"索引 {req.index_name} 创建成功"
            log_operation(db, "库表管理", "建索引", "success",
                          target_name=f"{req.table_name}.{req.index_name}",
                          message=f"在表 {req.table_name} 创建索引 {req.index_name} ({col_list})",
                          operator=user.username)
            db.commit()
        except Exception as e:
            result["error"] = str(e)
            result["executed"] = False
        finally:
            conn.close()

    return result


# ── POST /api/db-manager/drop-index ── Drop an index

@router.post("/drop-index")
def drop_index(
    req: DropIndexRequest,
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

    if ds.db_type == "mysql":
        sql = f"DROP INDEX {q(req.index_name, ds.db_type)} ON {q(req.table_name, ds.db_type)};"
    elif ds.db_type == "postgresql":
        sql = f"DROP INDEX {q(req.index_name, ds.db_type)};"
    elif ds.db_type == "sqlserver":
        sql = f"DROP INDEX {q(req.index_name, ds.db_type)} ON {q(req.table_name, ds.db_type)};"
    else:
        sql = f"DROP INDEX {q(req.index_name, ds.db_type)};"

    result = {"sql": sql, "executed": False}

    if req.execute:
        conn = _get_connection(ds)
        try:
            cursor = conn.cursor()
            cursor.execute(sql)
            conn.commit()
            result["executed"] = True
            result["message"] = f"索引 {req.index_name} 已删除"
            log_operation(db, "库表管理", "删索引", "success",
                          target_name=f"{req.table_name}.{req.index_name}",
                          message=f"从表 {req.table_name} 删除索引 {req.index_name}",
                          operator=user.username)
            db.commit()
        except Exception as e:
            result["error"] = str(e)
            result["executed"] = False
        finally:
            conn.close()

    return result


# ── Schemas for new endpoints ──

class RenameTableRequest(BaseModel):
    datasource_id: int
    old_name: str
    new_name: str
    execute: bool = False


class UpdateTableCommentRequest(BaseModel):
    datasource_id: int
    table_name: str
    comment: str
    execute: bool = False


# ── GET /api/db-manager/table-data ── Preview table data

@router.get("/table-data")
def get_table_data(
    datasource_id: int = Query(...),
    table_name: str = Query(...),
    limit: int = Query(100, le=1000, ge=1),
    offset: int = Query(0, ge=0),
    order_by: Optional[str] = Query(None),
    order_dir: str = Query("ASC"),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("operator")),
):
    """Preview table data (read-only, limit max 1000 rows)."""
    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == datasource_id,
        DatasourceConfig.is_deleted == 0,
    ).first()
    if not ds:
        raise HTTPException(404, "数据源不存在")

    order_dir = order_dir.upper()
    if order_dir not in ("ASC", "DESC"):
        order_dir = "ASC"

    q = _quote_ident
    tbl = q(table_name, ds.db_type)

    order_clause = ""
    if order_by:
        order_clause = f" ORDER BY {q(order_by, ds.db_type)} {order_dir}"

    if ds.db_type in ("mysql", "postgresql", "kingbase", "sqlite"):
        sql = f"SELECT * FROM {tbl}{order_clause} LIMIT {limit} OFFSET {offset}"
    elif ds.db_type == "sqlserver":
        if order_clause:
            sql = f"SELECT * FROM {tbl}{order_clause} OFFSET {offset} ROWS FETCH NEXT {limit} ROWS ONLY"
        else:
            sql = f"SELECT TOP {limit} * FROM {tbl}"
    elif ds.db_type in ("oracle", "dm"):
        if order_clause:
            sql = f"SELECT * FROM (SELECT t.*, ROWNUM rn FROM {tbl} t{order_clause}) WHERE rn > {offset} AND rn <= {offset + limit}"
        else:
            sql = f"SELECT * FROM {tbl} WHERE ROWNUM <= {offset + limit}"
    else:
        sql = f"SELECT * FROM {tbl}{order_clause} LIMIT {limit} OFFSET {offset}"

    conn = _get_connection(ds)
    try:
        cursor = conn.cursor()
        cursor.execute(sql)
        col_names = [desc[0] for desc in cursor.description] if cursor.description else []
        rows_raw = cursor.fetchall()
        rows = []
        for row in rows_raw:
            row_dict = {}
            for i, val in enumerate(row):
                if isinstance(val, datetime):
                    row_dict[col_names[i]] = val.isoformat()
                elif isinstance(val, bytes):
                    row_dict[col_names[i]] = f"<binary {len(val)} bytes>"
                else:
                    row_dict[col_names[i]] = val
            rows.append(row_dict)

        total_estimate = None
        try:
            if ds.db_type == "mysql":
                cursor.execute(
                    f"SELECT TABLE_ROWS FROM information_schema.TABLES "
                    f"WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '{table_name}'"
                )
                r = cursor.fetchone()
                total_estimate = r[0] if r else None
            elif ds.db_type in ("postgresql", "kingbase"):
                cursor.execute(f"SELECT reltuples::bigint FROM pg_class WHERE relname = '{table_name}'")
                r = cursor.fetchone()
                total_estimate = r[0] if r and r[0] >= 0 else None
            elif ds.db_type == "sqlite":
                cursor.execute(f"SELECT COUNT(*) FROM {tbl}")
                r = cursor.fetchone()
                total_estimate = r[0] if r else None
        except Exception:
            pass

        return {
            "columns": col_names,
            "rows": rows,
            "total_estimate": total_estimate,
            "limit": limit,
            "offset": offset,
        }
    except Exception as e:
        raise HTTPException(500, f"查询失败: {str(e)}")
    finally:
        conn.close()


# ── GET /api/db-manager/export-ddl ── Export CREATE TABLE DDL

@router.get("/export-ddl")
def export_ddl(
    datasource_id: int = Query(...),
    table_name: str = Query(...),
    include_indexes: bool = Query(True),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("operator")),
):
    """Export the CREATE TABLE DDL for a table."""
    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == datasource_id,
        DatasourceConfig.is_deleted == 0,
    ).first()
    if not ds:
        raise HTTPException(404, "数据源不存在")

    conn = _get_connection(ds)
    try:
        cursor = conn.cursor()
        ddl = ""

        if ds.db_type == "mysql":
            cursor.execute(f"SHOW CREATE TABLE `{table_name}`")
            row = cursor.fetchone()
            ddl = row[1] + ";" if row and len(row) > 1 else ""

        elif ds.db_type in ("postgresql", "kingbase"):
            schema = _get_schema_or_owner(ds)
            cursor.execute("""
                SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
                       c.character_maximum_length, c.numeric_precision, c.numeric_scale
                FROM information_schema.columns c
                WHERE c.table_schema = %s AND c.table_name = %s
                ORDER BY c.ordinal_position
            """, (schema, table_name))
            cols = cursor.fetchall()
            if not cols:
                raise HTTPException(404, "表不存在或无字段")
            col_lines = []
            for c in cols:
                col_name, dtype, nullable, default, char_len, num_prec, num_scale = c
                type_str = dtype.upper()
                if char_len:
                    type_str = f"{type_str}({char_len})"
                elif num_prec and dtype not in ("integer", "bigint", "smallint"):
                    type_str = f"{type_str}({num_prec},{num_scale or 0})"
                parts = [f'  "{col_name}" {type_str}']
                if nullable == "NO":
                    parts.append("NOT NULL")
                if default is not None:
                    parts.append(f"DEFAULT {default}")
                col_lines.append(" ".join(parts))
            cursor.execute("""
                SELECT kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                WHERE tc.table_schema = %s AND tc.table_name = %s AND tc.constraint_type = 'PRIMARY KEY'
                ORDER BY kcu.ordinal_position
            """, (schema, table_name))
            pk_cols = [r[0] for r in cursor.fetchall()]
            if pk_cols:
                pk_str = ", ".join(f'"{c}"' for c in pk_cols)
                col_lines.append(f"  PRIMARY KEY ({pk_str})")
            ddl = f'CREATE TABLE "{table_name}" (\n' + ",\n".join(col_lines) + "\n);"
            if include_indexes:
                cursor.execute("""
                    SELECT indexdef FROM pg_indexes
                    WHERE schemaname = %s AND tablename = %s
                      AND indexname NOT IN (
                          SELECT constraint_name FROM information_schema.table_constraints
                          WHERE table_schema = %s AND table_name = %s AND constraint_type = 'PRIMARY KEY'
                      )
                """, (schema, table_name, schema, table_name))
                for r in cursor.fetchall():
                    ddl += f"\n{r[0]};"

        elif ds.db_type == "sqlite":
            cursor.execute(f"SELECT sql FROM sqlite_master WHERE type='table' AND name='{table_name}'")
            row = cursor.fetchone()
            ddl = row[0] + ";" if row and row[0] else ""
            if include_indexes:
                cursor.execute(f"SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='{table_name}' AND sql IS NOT NULL")
                for r in cursor.fetchall():
                    ddl += f"\n{r[0]};"

        elif ds.db_type == "sqlserver":
            schema = _get_schema_or_owner(ds)
            cursor.execute("""
                SELECT c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT,
                       c.CHARACTER_MAXIMUM_LENGTH, c.NUMERIC_PRECISION, c.NUMERIC_SCALE
                FROM INFORMATION_SCHEMA.COLUMNS c
                WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ?
                ORDER BY c.ORDINAL_POSITION
            """, (schema, table_name))
            cols = cursor.fetchall()
            col_lines = []
            for c in cols:
                col_name, dtype, nullable, default, char_len, num_prec, num_scale = c
                type_str = dtype.upper()
                if char_len and char_len > 0:
                    type_str = f"{type_str}({char_len})" if char_len != -1 else f"{type_str}(MAX)"
                elif num_prec and dtype.lower() not in ("int", "bigint", "smallint", "tinyint"):
                    type_str = f"{type_str}({num_prec},{num_scale or 0})"
                parts = [f"  [{col_name}] {type_str}"]
                if nullable == "NO":
                    parts.append("NOT NULL")
                if default is not None:
                    parts.append(f"DEFAULT {default}")
                col_lines.append(" ".join(parts))
            ddl = f"CREATE TABLE [{table_name}] (\n" + ",\n".join(col_lines) + "\n);"

        elif ds.db_type in ("oracle", "dm"):
            owner = _get_schema_or_owner(ds)
            param = ":1" if ds.db_type == "oracle" else "?"
            cursor.execute(f"""
                SELECT column_name, data_type, nullable, data_default, data_length, data_precision, data_scale
                FROM all_tab_columns
                WHERE owner = {param} AND table_name = {param}
                ORDER BY column_id
            """, (owner, table_name.upper()))
            cols = cursor.fetchall()
            col_lines = []
            for c in cols:
                col_name, dtype, nullable, default, data_len, prec, scale = c
                type_str = dtype
                if dtype in ("VARCHAR2", "CHAR", "NVARCHAR2"):
                    type_str = f"{dtype}({data_len})"
                elif dtype == "NUMBER" and prec:
                    type_str = f"NUMBER({prec},{scale or 0})"
                parts = [f'  "{col_name}" {type_str}']
                if nullable == "N":
                    parts.append("NOT NULL")
                if default:
                    parts.append(f"DEFAULT {str(default).strip()}")
                col_lines.append(" ".join(parts))
            ddl = f'CREATE TABLE "{table_name}" (\n' + ",\n".join(col_lines) + "\n);"

        return {"ddl": ddl, "table_name": table_name}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"导出 DDL 失败: {str(e)}")
    finally:
        conn.close()


# ── POST /api/db-manager/rename-table ──

@router.post("/rename-table")
def rename_table(
    req: RenameTableRequest,
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
    old_q = q(req.old_name, ds.db_type)
    new_q = q(req.new_name, ds.db_type)

    if ds.db_type == "mysql":
        sql = f"RENAME TABLE {old_q} TO {new_q};"
    elif ds.db_type == "sqlserver":
        sql = f"EXEC sp_rename '{req.old_name}', '{req.new_name}';"
    else:
        sql = f"ALTER TABLE {old_q} RENAME TO {new_q};"

    result = {"sql": sql, "executed": False}

    if req.execute:
        conn = _get_connection(ds)
        try:
            cursor = conn.cursor()
            cursor.execute(sql)
            conn.commit()
            result["executed"] = True
            result["message"] = f"表已重命名: {req.old_name} -> {req.new_name}"
            log_operation(db, "库表管理", "重命名表", "success",
                          target_name=f"{req.old_name} -> {req.new_name}",
                          message=f"在数据源 {ds.datasource_name} 重命名表 {req.old_name} 为 {req.new_name}",
                          operator=user.username)
            db.commit()
        except Exception as e:
            result["error"] = str(e)
        finally:
            conn.close()

    return result


# ── POST /api/db-manager/update-table-comment ──

@router.post("/update-table-comment")
def update_table_comment(
    req: UpdateTableCommentRequest,
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
    comment_escaped = req.comment.replace("'", "''")

    if ds.db_type == "mysql":
        sql = f"ALTER TABLE {q(req.table_name, ds.db_type)} COMMENT='{comment_escaped}';"
    elif ds.db_type in ("postgresql", "kingbase"):
        sql = f"COMMENT ON TABLE {q(req.table_name, ds.db_type)} IS '{comment_escaped}';"
    elif ds.db_type in ("oracle", "dm"):
        sql = f"COMMENT ON TABLE {q(req.table_name, ds.db_type)} IS '{comment_escaped}';"
    elif ds.db_type == "sqlite":
        return {"sql": "-- SQLite does not support table comments", "executed": False, "message": "SQLite 不支持表注释"}
    else:
        return {"sql": f"-- Comment not supported for {ds.db_type}", "executed": False}

    result = {"sql": sql, "executed": False}

    if req.execute:
        conn = _get_connection(ds)
        try:
            cursor = conn.cursor()
            cursor.execute(sql)
            conn.commit()
            result["executed"] = True
            result["message"] = "表注释已更新"
            log_operation(db, "库表管理", "修改表注释", "success",
                          target_name=req.table_name,
                          message=f"修改表 {req.table_name} 注释为: {req.comment[:100]}",
                          operator=user.username)
            db.commit()
        except Exception as e:
            result["error"] = str(e)
        finally:
            conn.close()

    return result
