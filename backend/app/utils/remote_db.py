"""Utilities for querying remote databases: list tables, list columns, fetch sample data, compute structure hash."""

import hashlib
import json
from typing import List, Tuple, Optional, Any, Dict

from app.utils.db_connector import test_connection


def _get_mysql_conn(host, port, user, password, database, charset="utf8", timeout=10):
    import pymysql
    return pymysql.connect(
        host=host, port=port, user=user, password=password,
        database=database or "", charset=charset or "utf8",
        connect_timeout=timeout,
    )


def _get_pg_conn(host, port, user, password, database, timeout=10):
    import psycopg2
    dsn = f"host={host} port={port} user={user} password={password} connect_timeout={timeout}"
    if database:
        dsn += f" dbname={database}"
    return psycopg2.connect(dsn)


def _get_sqlserver_conn(host, port, user, password, database, timeout=10):
    import pyodbc
    conn_str = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={host},{port};"
        f"UID={user};PWD={password};"
        f"CONNECTION TIMEOUT={timeout};"
    )
    if database:
        conn_str += f"DATABASE={database};"
    return pyodbc.connect(conn_str, timeout=timeout)


def _get_oracle_conn(host, port, user, password, database, timeout=10):
    import oracledb
    dsn = oracledb.makedsn(host, port, service_name=database or "ORCL")
    conn = oracledb.connect(user=user, password=password, dsn=dsn)
    return conn


def _get_dm_conn(host, port, user, password, database, timeout=10):
    import pyodbc
    conn_str = (
        f"DRIVER={{DM8 ODBC DRIVER}};"
        f"SERVER={host};"
        f"PORT={port};"
        f"UID={user};PWD={password};"
    )
    if database:
        conn_str += f"DATABASE={database};"
    return pyodbc.connect(conn_str, timeout=timeout)


def _get_kingbase_conn(host, port, user, password, database, timeout=10):
    """人大金仓兼容 PostgreSQL 协议。"""
    import psycopg2
    dsn = f"host={host} port={port} user={user} password={password} connect_timeout={timeout}"
    if database:
        dsn += f" dbname={database}"
    return psycopg2.connect(dsn)


def _get_sqlite_conn(host, port, user, password, database, timeout=10):
    """SQLite 使用文件路径连接。database 或 host 作为文件路径。"""
    import sqlite3
    db_path = database or host
    if not db_path:
        raise ValueError("SQLite 需要指定数据库文件路径")
    conn = sqlite3.connect(db_path, timeout=timeout)
    return conn


def _connect(db_type, host, port, user, password, database=None, schema=None, charset="utf8", timeout=10):
    if db_type == "mysql":
        return _get_mysql_conn(host, port, user, password, database, charset, timeout)
    elif db_type == "postgresql":
        return _get_pg_conn(host, port, user, password, database, timeout)
    elif db_type == "sqlserver":
        return _get_sqlserver_conn(host, port, user, password, database, timeout)
    elif db_type == "oracle":
        return _get_oracle_conn(host, port, user, password, database, timeout)
    elif db_type == "dm":
        return _get_dm_conn(host, port, user, password, database, timeout)
    elif db_type == "kingbase":
        return _get_kingbase_conn(host, port, user, password, database, timeout)
    elif db_type == "sqlite":
        return _get_sqlite_conn(host, port, user, password, database, timeout)
    else:
        raise ValueError(f"不支持的数据库类型: {db_type}")


def list_databases(db_type: str, host: str, port: int, user: str, password: str,
                   charset: str = "utf8", timeout: int = 10) -> List[str]:
    """Return list of database/schema names available on the server."""
    conn = _connect(db_type, host, port, user, password, None, None, charset, timeout)
    try:
        cur = conn.cursor()
        if db_type == "mysql":
            cur.execute("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME")
        elif db_type in ("postgresql", "kingbase"):
            cur.execute("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname")
        elif db_type == "sqlserver":
            cur.execute("SELECT name FROM sys.databases WHERE state_desc = 'ONLINE' ORDER BY name")
        elif db_type == "oracle":
            # Oracle: list schemas (users) with tables
            cur.execute("SELECT DISTINCT owner FROM all_tables ORDER BY owner")
        elif db_type == "dm":
            try:
                cur.execute("SELECT DISTINCT owner FROM ALL_TABLES ORDER BY owner")
            except Exception:
                cur.execute("SELECT name FROM sys.databases ORDER BY name")
        elif db_type == "sqlite":
            return []
        else:
            return []
        return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()


def list_tables(db_type: str, host: str, port: int, user: str, password: str,
                database: Optional[str] = None, schema: Optional[str] = None,
                charset: str = "utf8", timeout: int = 10) -> List[Dict]:
    """Return list of {table_name, table_comment}."""
    conn = _connect(db_type, host, port, user, password, database, schema, charset, timeout)
    try:
        cur = conn.cursor()
        if db_type == "mysql":
            sql = "SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = %s AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
            cur.execute(sql, (database or "",))
        elif db_type in ("postgresql", "kingbase"):
            sch = schema or "public"
            sql = """
                SELECT c.relname AS table_name,
                       obj_description(c.oid) AS table_comment
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = %s AND c.relkind = 'r'
                ORDER BY c.relname
            """
            cur.execute(sql, (sch,))
        elif db_type == "sqlserver":
            sch = schema or "dbo"
            sql = """
                SELECT t.name AS table_name,
                       CAST(ep.value AS NVARCHAR(MAX)) AS table_comment
                FROM sys.tables t
                LEFT JOIN sys.extended_properties ep
                    ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
                LEFT JOIN sys.schemas s ON s.schema_id = t.schema_id
                WHERE s.name = ?
                ORDER BY t.name
            """
            cur.execute(sql, (sch,))
        elif db_type == "oracle":
            owner = (schema or user).upper()
            sql = """
                SELECT table_name, comments
                FROM all_tab_comments
                WHERE owner = :1 AND table_type = 'TABLE'
                ORDER BY table_name
            """
            cur.execute(sql, (owner,))
        elif db_type == "dm":
            sch = schema or user
            sql = """
                SELECT t.name AS table_name,
                       ep.value AS table_comment
                FROM sys.tables t
                LEFT JOIN sys.extended_properties ep
                    ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
                LEFT JOIN sys.schemas s ON s.schema_id = t.schema_id
                WHERE s.name = ?
                ORDER BY t.name
            """
            # 达梦兼容 SQL Server 语法；如果不行则回退到 information_schema
            try:
                cur.execute(sql, (sch,))
            except Exception:
                cur.execute(
                    "SELECT TABLE_NAME, COMMENTS FROM ALL_TAB_COMMENTS WHERE OWNER = ? ORDER BY TABLE_NAME",
                    (sch.upper(),)
                )
        elif db_type == "sqlite":
            sql = "SELECT name, NULL FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            cur.execute(sql)

        rows = cur.fetchall()
        result = []
        for r in rows:
            result.append({
                "table_name": r[0],
                "table_comment": r[1] if len(r) > 1 and r[1] else None,
            })
        return result
    finally:
        conn.close()


def list_columns(db_type: str, host: str, port: int, user: str, password: str,
                 table_name: str, database: Optional[str] = None, schema: Optional[str] = None,
                 charset: str = "utf8", timeout: int = 10) -> List[Dict]:
    """Return list of column dicts with keys: field_name, db_data_type, is_nullable, column_default, is_primary_key, ordinal_position."""
    conn = _connect(db_type, host, port, user, password, database, schema, charset, timeout)
    try:
        cur = conn.cursor()
        if db_type == "mysql":
            sql = """
                SELECT c.COLUMN_NAME, c.COLUMN_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT, c.ORDINAL_POSITION,
                       CASE WHEN kcu.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_pk
                FROM information_schema.COLUMNS c
                LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu
                    ON kcu.TABLE_SCHEMA = c.TABLE_SCHEMA
                    AND kcu.TABLE_NAME = c.TABLE_NAME
                    AND kcu.COLUMN_NAME = c.COLUMN_NAME
                    AND kcu.CONSTRAINT_NAME = 'PRIMARY'
                WHERE c.TABLE_SCHEMA = %s AND c.TABLE_NAME = %s
                ORDER BY c.ORDINAL_POSITION
            """
            cur.execute(sql, (database or "", table_name))
        elif db_type in ("postgresql", "kingbase"):
            sch = schema or "public"
            sql = """
                SELECT c.column_name, c.data_type, c.is_nullable, c.column_default, c.ordinal_position,
                       CASE WHEN tc.constraint_type = 'PRIMARY KEY' THEN 1 ELSE 0 END AS is_pk
                FROM information_schema.columns c
                LEFT JOIN information_schema.key_column_usage kcu
                    ON kcu.table_schema = c.table_schema AND kcu.table_name = c.table_name AND kcu.column_name = c.column_name
                LEFT JOIN information_schema.table_constraints tc
                    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.constraint_type = 'PRIMARY KEY'
                WHERE c.table_schema = %s AND c.table_name = %s
                ORDER BY c.ordinal_position
            """
            cur.execute(sql, (sch, table_name))
        elif db_type == "sqlserver":
            sch = schema or "dbo"
            sql = """
                SELECT c.name AS column_name,
                       TYPE_NAME(c.user_type_id) + CASE WHEN c.max_length > 0 AND TYPE_NAME(c.user_type_id) IN ('varchar','nvarchar','char','nchar') THEN '(' + CAST(c.max_length AS VARCHAR) + ')' ELSE '' END AS data_type,
                       c.is_nullable,
                       dc.definition AS column_default,
                       c.column_id AS ordinal_position,
                       CASE WHEN ic.column_id IS NOT NULL THEN 1 ELSE 0 END AS is_pk
                FROM sys.columns c
                JOIN sys.tables t ON t.object_id = c.object_id
                JOIN sys.schemas s ON s.schema_id = t.schema_id
                LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
                LEFT JOIN sys.indexes i ON i.object_id = t.object_id AND i.is_primary_key = 1
                LEFT JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.column_id = c.column_id
                WHERE s.name = ? AND t.name = ?
                ORDER BY c.column_id
            """
            cur.execute(sql, (sch, table_name))
        elif db_type == "oracle":
            owner = (schema or user).upper()
            sql = """
                SELECT col.COLUMN_NAME,
                       col.DATA_TYPE || CASE WHEN col.DATA_TYPE IN ('VARCHAR2','CHAR','NVARCHAR2','NCHAR') THEN '(' || col.DATA_LENGTH || ')' WHEN col.DATA_TYPE = 'NUMBER' AND col.DATA_PRECISION IS NOT NULL THEN '(' || col.DATA_PRECISION || ',' || col.DATA_SCALE || ')' ELSE '' END AS data_type,
                       col.NULLABLE,
                       col.DATA_DEFAULT,
                       col.COLUMN_ID,
                       CASE WHEN cc.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_pk
                FROM all_tab_columns col
                LEFT JOIN (
                    SELECT acc.OWNER, acc.TABLE_NAME, acc.COLUMN_NAME
                    FROM all_cons_columns acc
                    JOIN all_constraints ac ON ac.OWNER = acc.OWNER AND ac.CONSTRAINT_NAME = acc.CONSTRAINT_NAME
                    WHERE ac.CONSTRAINT_TYPE = 'P'
                ) cc ON cc.OWNER = col.OWNER AND cc.TABLE_NAME = col.TABLE_NAME AND cc.COLUMN_NAME = col.COLUMN_NAME
                WHERE col.OWNER = :1 AND col.TABLE_NAME = :2
                ORDER BY col.COLUMN_ID
            """
            cur.execute(sql, (owner, table_name.upper()))
        elif db_type == "dm":
            # 达梦兼容 Oracle 的数据字典视图
            owner = (schema or user).upper()
            sql = """
                SELECT col.COLUMN_NAME,
                       col.DATA_TYPE || CASE WHEN col.DATA_TYPE IN ('VARCHAR2','CHAR','VARCHAR') THEN '(' || col.DATA_LENGTH || ')' WHEN col.DATA_TYPE = 'NUMBER' AND col.DATA_PRECISION IS NOT NULL THEN '(' || col.DATA_PRECISION || ',' || col.DATA_SCALE || ')' ELSE '' END AS data_type,
                       col.NULLABLE,
                       col.DATA_DEFAULT,
                       col.COLUMN_ID,
                       CASE WHEN cc.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_pk
                FROM ALL_TAB_COLUMNS col
                LEFT JOIN (
                    SELECT acc.OWNER, acc.TABLE_NAME, acc.COLUMN_NAME
                    FROM ALL_CONS_COLUMNS acc
                    JOIN ALL_CONSTRAINTS ac ON ac.OWNER = acc.OWNER AND ac.CONSTRAINT_NAME = acc.CONSTRAINT_NAME
                    WHERE ac.CONSTRAINT_TYPE = 'P'
                ) cc ON cc.OWNER = col.OWNER AND cc.TABLE_NAME = col.TABLE_NAME AND cc.COLUMN_NAME = col.COLUMN_NAME
                WHERE col.OWNER = ? AND col.TABLE_NAME = ?
                ORDER BY col.COLUMN_ID
            """
            cur.execute(sql, (owner, table_name.upper()))
        elif db_type == "sqlite":
            # SQLite uses PRAGMA table_info to get column info
            cur.execute(f"PRAGMA table_info(`{table_name}`)")
            sqlite_rows = cur.fetchall()
            result = []
            for r in sqlite_rows:
                # PRAGMA table_info returns: cid, name, type, notnull, dflt_value, pk
                result.append({
                    "field_name": r[1],
                    "db_data_type": r[2] or "TEXT",
                    "is_nullable": not bool(r[3]),
                    "column_default": str(r[4]) if r[4] is not None else None,
                    "ordinal_position": r[0] + 1,
                    "is_primary_key": bool(r[5]),
                })
            return result

        rows = cur.fetchall()
        result = []
        for r in rows:
            result.append({
                "field_name": r[0],
                "db_data_type": str(r[1]),
                "is_nullable": r[2] in (True, 'YES', 'Y', 1),
                "column_default": str(r[3]) if r[3] is not None else None,
                "ordinal_position": r[4],
                "is_primary_key": bool(r[5]),
            })
        return result
    finally:
        conn.close()


def fetch_sample_data(db_type: str, host: str, port: int, user: str, password: str,
                      table_name: str, database: Optional[str] = None, schema: Optional[str] = None,
                      charset: str = "utf8", timeout: int = 10,
                      limit: int = 5) -> Tuple[List[str], List[List[Optional[str]]]]:
    """Return (columns, rows) where each cell is a string."""
    conn = _connect(db_type, host, port, user, password, database, schema, charset, timeout)
    try:
        cur = conn.cursor()
        qualified = table_name
        if db_type in ("postgresql", "kingbase"):
            sch = schema or "public"
            qualified = f'"{sch}"."{table_name}"'
        elif db_type == "sqlserver":
            sch = schema or "dbo"
            qualified = f"[{sch}].[{table_name}]"
        elif db_type == "oracle":
            owner = (schema or user).upper()
            qualified = f'"{owner}"."{table_name.upper()}"'
        elif db_type == "dm":
            owner = (schema or user).upper()
            qualified = f'"{owner}"."{table_name.upper()}"'
        elif db_type == "sqlite":
            qualified = f'`{table_name}`'

        if db_type == "sqlserver":
            cur.execute(f"SELECT TOP {limit} * FROM {qualified}")
        elif db_type in ("oracle", "dm"):
            cur.execute(f"SELECT * FROM {qualified} WHERE ROWNUM <= {limit}")
        else:
            cur.execute(f"SELECT * FROM {qualified} LIMIT {limit}")

        columns = [desc[0] for desc in cur.description]
        raw_rows = cur.fetchall()
        rows = []
        for raw in raw_rows:
            rows.append([str(v) if v is not None else None for v in raw])
        return columns, rows
    finally:
        conn.close()


def compute_structure_hash(columns: List[Dict]) -> str:
    """Compute a deterministic hash from column list for structure change detection."""
    normalized = []
    for c in columns:
        normalized.append({
            "field_name": c["field_name"],
            "db_data_type": c["db_data_type"],
            "is_primary_key": c.get("is_primary_key", False),
            "ordinal_position": c.get("ordinal_position", 0),
        })
    normalized.sort(key=lambda x: x["ordinal_position"])
    payload = json.dumps(normalized, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]
