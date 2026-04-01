"""Multi-table writeback confirmation — POST /api/writeback/multi-confirm"""

import json
import os
import uuid
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db, DATA_DIR
from app.models import (
    TableConfig, FieldConfig, DatasourceConfig,
    ImportTaskLog, WritebackLog, TableBackupVersion, FieldChangeLog,
    _now_bjt,
)
from app.utils.crypto import decrypt_password
from app.utils.remote_db import _connect
from app.utils.auth import get_current_user, require_role
from app.utils.permissions import get_permitted_datasource_ids
from app.utils.audit import log_operation
from app.models import UserAccount
from app.i18n import t

router = APIRouter(prefix="/api/writeback", tags=["Writeback Multi"])

UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ── Schemas ──

class TableConfirmation(BaseModel):
    table_id: int
    confirmed: bool


class MultiConfirmRequest(BaseModel):
    session_id: str
    confirmations: List[TableConfirmation]


# ── Helpers ──

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


def _placeholder(db_type: str) -> str:
    if db_type in ("oracle", "dm"):
        return ":1"
    return "%s"


def _exec(cur, db_type: str, sql: str, params: list) -> None:
    import re as _re
    if db_type in ("oracle", "dm"):
        counter = [0]
        def _repl(m):
            counter[0] += 1
            return f":{counter[0]}"
        sql2 = _re.sub(r'%s', _repl, sql)
        cur.execute(sql2, params)
    else:
        cur.execute(sql, params)


def _cast_to_text(db_type: str, col_expr: str) -> str:
    if db_type in ("postgresql", "kingbase"):
        return f"CAST({col_expr} AS TEXT)"
    elif db_type == "mysql":
        return f"CAST({col_expr} AS CHAR)"
    elif db_type == "sqlserver":
        return f"CAST({col_expr} AS NVARCHAR(MAX))"
    elif db_type in ("oracle", "dm"):
        return f"TO_CHAR({col_expr})"
    return col_expr


def _create_backup_table(cur, db_type, source_qt, backup_table_name, schema):
    if db_type in ("postgresql", "kingbase"):
        sch = schema or "public"
        bk_qt = f'"{sch}"."{backup_table_name}"'
        cur.execute(f'CREATE TABLE {bk_qt} AS SELECT * FROM {source_qt}')
    elif db_type == "mysql":
        bk_qt = f"`{backup_table_name}`"
        cur.execute(f"CREATE TABLE {bk_qt} AS SELECT * FROM {source_qt}")
    elif db_type == "sqlserver":
        sch = schema or "dbo"
        bk_qt = f"[{sch}].[{backup_table_name}]"
        cur.execute(f"SELECT * INTO {bk_qt} FROM {source_qt}")
    elif db_type in ("oracle", "dm"):
        bk_qt = f'"{backup_table_name.upper()}"'
        cur.execute(f'CREATE TABLE {bk_qt} AS SELECT * FROM {source_qt}')
    else:
        bk_qt = f"`{backup_table_name}`"
        cur.execute(f"CREATE TABLE {bk_qt} AS SELECT * FROM {source_qt}")


def _drop_table_if_exists(cur, db_type, table_qt):
    try:
        if db_type in ("postgresql", "kingbase", "mysql"):
            cur.execute(f"DROP TABLE IF EXISTS {table_qt}")
        elif db_type == "sqlserver":
            cur.execute(f"IF OBJECT_ID('{table_qt}', 'U') IS NOT NULL DROP TABLE {table_qt}")
        elif db_type in ("oracle", "dm"):
            try:
                cur.execute(f"DROP TABLE {table_qt}")
            except Exception:
                pass
        else:
            cur.execute(f"DROP TABLE IF EXISTS {table_qt}")
    except Exception:
        pass


def _writeback_single_table(
    db: Session, table_id: int, changes: list[dict],
    parsed_rule: dict, user, explanation: str,
) -> dict:
    """Execute writeback for a single table: backup → update → log."""
    tc = db.query(TableConfig).filter(
        TableConfig.id == table_id,
        TableConfig.is_deleted == 0,
        TableConfig.status == "enabled",
    ).first()
    if not tc:
        return {"table_id": table_id, "status": "error", "error": t("writeback_multi.table_not_found")}

    # Check datasource-level permission
    permitted_ids = get_permitted_datasource_ids(db, user)
    if permitted_ids is not None and tc.datasource_id not in permitted_ids:
        return {"table_id": table_id, "status": "error", "error": t("writeback_multi.table_not_found")}

    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == tc.datasource_id,
        DatasourceConfig.is_deleted == 0,
    ).first()
    if not ds:
        return {"table_id": table_id, "status": "error", "error": t("writeback_multi.datasource_not_found")}

    fields = (
        db.query(FieldConfig)
        .filter(FieldConfig.table_config_id == tc.id, FieldConfig.is_deleted == 0)
        .order_by(FieldConfig.field_order_no)
        .all()
    )
    pk_fields_list = [p.strip() for p in tc.primary_key_fields.split(",")]

    pwd = decrypt_password(ds.password_encrypted)
    wb_batch = f"WBMULTI_{_now_bjt().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:4].upper()}"
    bk_batch = f"BK_{_now_bjt().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:4].upper()}"
    started_at = _now_bjt()

    conn = _connect(
        ds.db_type, ds.host, ds.port, ds.username, pwd,
        tc.db_name, tc.schema_name, ds.charset, ds.connect_timeout_seconds or 10,
    )
    try:
        cur = conn.cursor()
        qt = _qualified_table(ds.db_type, tc.table_name, tc.schema_name)
        ph = _placeholder(ds.db_type)

        # Step 1: Backup
        ts = _now_bjt().strftime("%Y%m%d_%H%M%S")
        rand_suffix = uuid.uuid4().hex[:4].upper()
        backup_table_name = f"{tc.table_name}_bak_{ts}_{rand_suffix}"

        _create_backup_table(cur, ds.db_type, qt, backup_table_name, tc.schema_name)

        bk_qt = _qualified_table(ds.db_type, backup_table_name, tc.schema_name)
        cur.execute(f"SELECT COUNT(*) FROM {bk_qt}")
        backup_count = cur.fetchone()[0]
        conn.commit()

        backup_rec = TableBackupVersion(
            backup_version_no=bk_batch,
            table_config_id=tc.id,
            datasource_id=tc.datasource_id,
            backup_table_name=backup_table_name,
            source_table_name=tc.table_name,
            source_db_name=tc.db_name,
            source_schema_name=tc.schema_name,
            trigger_type="triggered_by_writeback",
            related_writeback_batch_no=wb_batch,
            record_count=backup_count,
            storage_status="valid",
            can_rollback=1,
            backup_started_at=started_at,
            backup_finished_at=_now_bjt(),
            operator_user=user.username if user else "system",
        )
        db.add(backup_rec)
        db.flush()

        # Clean old backups
        old_backups = (
            db.query(TableBackupVersion)
            .filter(
                TableBackupVersion.table_config_id == tc.id,
                TableBackupVersion.storage_status == "valid",
            )
            .order_by(TableBackupVersion.id.desc())
            .all()
        )
        if len(old_backups) > tc.backup_keep_count:
            for old_bk in old_backups[tc.backup_keep_count:]:
                try:
                    old_bk_qt = _qualified_table(ds.db_type, old_bk.backup_table_name, old_bk.source_schema_name)
                    _drop_table_if_exists(cur, ds.db_type, old_bk_qt)
                    conn.commit()
                except Exception:
                    pass
                old_bk.storage_status = "expired"
                old_bk.can_rollback = 0

        # Step 2: Execute UPDATEs
        success_count = 0
        fail_count = 0
        failed_details = []
        change_logs_data = []

        # Group changes by pk_value
        changes_by_pk: dict[str, list[dict]] = {}
        for c in changes:
            pk = c["pk_value"]
            if pk not in changes_by_pk:
                changes_by_pk[pk] = []
            changes_by_pk[pk].append(c)

        for pk_key, row_changes in changes_by_pk.items():
            set_parts = []
            set_params = []
            for c in row_changes:
                fn = c["field"]
                set_parts.append(f"{_quote_col(ds.db_type, fn)} = {ph}")
                set_params.append(c["new_value"])

            # WHERE from PK
            where_parts = []
            where_params = []
            pk_vals = pk_key.split("|")
            for i, pkf in enumerate(pk_fields_list):
                pk_val = pk_vals[i] if i < len(pk_vals) else ""
                where_parts.append(f"{_cast_to_text(ds.db_type, _quote_col(ds.db_type, pkf))} = {ph}")
                where_params.append(pk_val)

            update_sql = f"UPDATE {qt} SET {', '.join(set_parts)} WHERE {' AND '.join(where_parts)}"
            try:
                _exec(cur, ds.db_type, update_sql, set_params + where_params)
                success_count += 1
                for c in row_changes:
                    change_logs_data.append({
                        "row_pk_value": pk_key,
                        "field_name": c["field"],
                        "old_value": c.get("old_value"),
                        "new_value": c["new_value"],
                        "change_type": "update",
                    })
            except Exception as e:
                fail_count += 1
                failed_details.append({
                    "pk_key": pk_key,
                    "error": str(e),
                })

        conn.commit()
        finished_at = _now_bjt()
        wb_status = "success" if fail_count == 0 else ("failed" if success_count == 0 else "partial")

        # Record writeback log
        wb_log = WritebackLog(
            writeback_batch_no=wb_batch,
            import_task_id=None,
            table_config_id=tc.id,
            datasource_id=tc.datasource_id,
            backup_version_no=bk_batch,
            total_row_count=len(changes_by_pk),
            success_row_count=success_count,
            failed_row_count=fail_count,
            skipped_row_count=0,
            inserted_row_count=0,
            updated_row_count=success_count,
            deleted_row_count=0,
            writeback_status=wb_status,
            writeback_message=f"多表批量修改：更新 {success_count}，失败 {fail_count}",
            failed_detail_json=json.dumps(failed_details, ensure_ascii=False) if failed_details else None,
            operator_user=user.username if user else "system",
            started_at=started_at,
            finished_at=finished_at,
        )
        db.add(wb_log)
        db.flush()

        # Field change logs
        for cl in change_logs_data:
            db.add(FieldChangeLog(
                writeback_log_id=wb_log.id,
                row_pk_value=cl["row_pk_value"],
                field_name=cl["field_name"],
                old_value=cl["old_value"],
                new_value=cl["new_value"],
                change_type=cl["change_type"],
            ))

        log_operation(
            db, "AI批量修改", "多表回写", wb_status,
            target_id=tc.id, target_name=tc.table_name,
            message=f"多表回写 {wb_batch}，更新 {success_count}，失败 {fail_count}，备份 {bk_batch}",
            operator=user.username if user else "system",
        )

        # Notification
        from app.utils.notifications import notify_user_by_username
        ntype = "success" if wb_status == "success" else ("error" if wb_status == "failed" else "warning")
        notify_user_by_username(
            db, user.username if user else "system",
            "多表回写%s" % ("成功" if wb_status == "success" else "完成"),
            "表「%s」多表回写 %s，更新 %d，失败 %d" % (
                tc.table_alias or tc.table_name, wb_batch, success_count, fail_count),
            ntype=ntype,
            related_url="/log-center",
        )

        db.commit()

        return {
            "table_id": table_id,
            "table_name": tc.table_alias or tc.table_name,
            "status": wb_status,
            "updated": success_count,
            "failed": fail_count,
            "backup_table": backup_table_name,
            "writeback_batch_no": wb_batch,
            "error": None,
        }

    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        return {
            "table_id": table_id,
            "table_name": tc.table_alias or tc.table_name if tc else "未知",
            "status": "error",
            "updated": 0,
            "failed": 0,
            "error": str(e),
        }
    finally:
        conn.close()


# ── API Endpoint ──

@router.post("/multi-confirm")
async def multi_confirm(
    body: MultiConfirmRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin", "operator")),
):
    """Confirm and execute writeback for multiple tables sequentially."""
    # Load preview data
    preview_file = os.path.join(UPLOAD_DIR, f"multi_preview_{body.session_id}.json")
    if not os.path.isfile(preview_file):
        raise HTTPException(404, t("writeback_multi.preview_not_found"))

    with open(preview_file, "r", encoding="utf-8") as f:
        preview_data = json.load(f)

    # Build map of confirmed table_ids
    confirmed_ids = {c.table_id for c in body.confirmations if c.confirmed}
    if not confirmed_ids:
        raise HTTPException(400, t("writeback_multi.no_confirm"))

    # Build table data map from preview
    table_data_map = {}
    for t in preview_data.get("tables", []):
        if t["table_id"] in confirmed_ids and t.get("status") == "has_changes":
            table_data_map[t["table_id"]] = t

    if not table_data_map:
        raise HTTPException(400, t("writeback_multi.no_changes"))

    # Execute writeback sequentially
    results = []
    success_count = 0
    fail_count = 0
    stopped = False

    for tid in confirmed_ids:
        if stopped:
            results.append({
                "table_id": tid,
                "table_name": table_data_map.get(tid, {}).get("table_name", "未知"),
                "status": "skipped",
                "error": t("writeback_multi.skipped_prev_fail"),
            })
            continue

        tdata = table_data_map.get(tid)
        if not tdata:
            results.append({
                "table_id": tid,
                "table_name": "未知",
                "status": "skipped",
                "error": t("writeback_multi.skipped_no_data"),
            })
            continue

        result = _writeback_single_table(
            db, tid, tdata["changes"],
            tdata.get("parsed_rule", {}), user,
            tdata.get("explanation", ""),
        )
        results.append(result)

        if result["status"] == "error" or result["status"] == "failed":
            fail_count += 1
            stopped = True
        else:
            success_count += 1

    # Clean up preview file
    try:
        os.remove(preview_file)
    except Exception:
        pass

    overall_status = "success" if fail_count == 0 else ("failed" if success_count == 0 else "partial")

    return {
        "success": True,
        "data": {
            "status": overall_status,
            "tables_success": success_count,
            "tables_failed": fail_count,
            "results": results,
        },
    }
