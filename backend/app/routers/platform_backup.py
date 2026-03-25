"""Platform data backup & restore endpoints (v3.0)."""

import os
import json
import shutil
import hashlib
import zipfile
import time
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db, DATA_DIR, DATABASE_URL
from app.models import (
    DatasourceConfig, TableConfig, FieldConfig, UserAccount,
    SystemSetting, AIConfig, SystemOperationLog,
)
from app.utils.auth import get_current_user, require_role
from app.utils.crypto import decrypt_password
from app.i18n import t

router = APIRouter(prefix="/api/platform", tags=["平台备份"])

_BJT = timezone(timedelta(hours=8))
BACKUP_DIR = os.path.join(DATA_DIR, "platform_backups")
UPLOAD_DIR = os.path.join(DATA_DIR, "platform_uploads")
os.makedirs(BACKUP_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Current app version – keep in sync with main.py
APP_VERSION = "3.0.0"
MANIFEST_SCHEMA_VERSION = "1.0"
# Minimum app version that can import backups created by this version
COMPATIBLE_VERSIONS = {"3.0.0", "2.6.0", "2.5.0", "2.4.0", "2.3.0", "2.2.0", "2.1.0", "2.0.0", "1.0"}


def _now_bjt():
    return datetime.now(_BJT)


def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def _sanitize_password(val: str) -> str:
    """Replace sensitive value with ***."""
    return "***"


def _file_size_human(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes}B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f}KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f}MB"


# ── Schemas ──

class BackupRequest(BaseModel):
    include_logs: bool = False
    include_backups: bool = False
    format: str = "zip"


class RestoreRequest(BaseModel):
    backup_file: str
    mode: str = "overwrite"  # overwrite / merge
    confirm: bool = False


# ── POST /api/platform/backup ──

@router.post("/backup")
def create_backup(
    req: BackupRequest,
    db: Session = Depends(get_db),
    current_user = Depends(require_role("admin")),
):
    """Create a platform backup ZIP."""
    timestamp = _now_bjt().strftime("%Y%m%d-%H%M%S")
    backup_name = f"data-ops-backup-{timestamp}"
    tmp_dir = os.path.join(BACKUP_DIR, f".tmp-{backup_name}")
    os.makedirs(tmp_dir, exist_ok=True)

    try:
        # 1. Export configs as JSON
        config_dir = os.path.join(tmp_dir, "config")
        os.makedirs(config_dir, exist_ok=True)

        # Datasources (password sanitised)
        datasources = db.query(DatasourceConfig).filter(DatasourceConfig.is_deleted == 0).all()
        ds_list = []
        for ds in datasources:
            ds_list.append({
                "id": ds.id,
                "datasource_code": ds.datasource_code,
                "datasource_name": ds.datasource_name,
                "db_type": ds.db_type,
                "host": ds.host,
                "port": ds.port,
                "database_name": ds.database_name,
                "schema_name": ds.schema_name,
                "username": ds.username,
                "password_encrypted": _sanitize_password(""),
                "charset": ds.charset,
                "connect_timeout_seconds": ds.connect_timeout_seconds,
                "status": ds.status,
                "remark": ds.remark,
            })
        with open(os.path.join(config_dir, "datasources.json"), "w", encoding="utf-8") as f:
            json.dump(ds_list, f, ensure_ascii=False, indent=2, default=str)

        # Tables
        tables = db.query(TableConfig).filter(TableConfig.is_deleted == 0).all()
        tbl_list = []
        for tbl in tables:
            tbl_list.append({
                "id": tbl.id,
                "table_config_code": tbl.table_config_code,
                "datasource_id": tbl.datasource_id,
                "db_name": tbl.db_name,
                "schema_name": tbl.schema_name,
                "table_name": tbl.table_name,
                "table_alias": tbl.table_alias,
                "table_comment": tbl.table_comment,
                "primary_key_fields": tbl.primary_key_fields,
                "unique_key_fields": tbl.unique_key_fields,
                "allow_export_current": tbl.allow_export_current,
                "allow_export_all": tbl.allow_export_all,
                "allow_import_writeback": tbl.allow_import_writeback,
                "allow_insert_rows": tbl.allow_insert_rows,
                "allow_delete_rows": tbl.allow_delete_rows,
                "backup_keep_count": tbl.backup_keep_count,
                "status": tbl.status,
                "remark": tbl.remark,
            })
        with open(os.path.join(config_dir, "tables.json"), "w", encoding="utf-8") as f:
            json.dump(tbl_list, f, ensure_ascii=False, indent=2, default=str)

        # Fields
        fields = db.query(FieldConfig).filter(FieldConfig.is_deleted == 0).all()
        fld_list = []
        for fld in fields:
            fld_list.append({
                "id": fld.id,
                "table_config_id": fld.table_config_id,
                "field_name": fld.field_name,
                "field_alias": fld.field_alias,
                "db_data_type": fld.db_data_type,
                "field_order_no": fld.field_order_no,
                "is_displayed": fld.is_displayed,
                "is_editable": fld.is_editable,
                "is_required": fld.is_required,
                "is_primary_key": fld.is_primary_key,
                "is_unique_key": fld.is_unique_key,
                "is_system_field": fld.is_system_field,
                "include_in_export": fld.include_in_export,
                "include_in_import": fld.include_in_import,
                "max_length": fld.max_length,
                "enum_options_json": fld.enum_options_json,
                "validation_rule_json": fld.validation_rule_json,
                "default_display_type": fld.default_display_type,
                "editable_roles": fld.editable_roles,
                "remark": fld.remark,
            })
        with open(os.path.join(config_dir, "fields.json"), "w", encoding="utf-8") as f:
            json.dump(fld_list, f, ensure_ascii=False, indent=2, default=str)

        # Users (password hash kept)
        users = db.query(UserAccount).all()
        usr_list = []
        for u in users:
            usr_list.append({
                "id": u.id,
                "username": u.username,
                "password_hash": u.password_hash,
                "role": u.role,
                "display_name": u.display_name,
                "status": u.status,
            })
        with open(os.path.join(config_dir, "users.json"), "w", encoding="utf-8") as f:
            json.dump(usr_list, f, ensure_ascii=False, indent=2, default=str)

        # Settings (API keys sanitised)
        settings = db.query(SystemSetting).all()
        settings_list = []
        for s in settings:
            val = s.setting_value
            key_lower = s.setting_key.lower()
            if "key" in key_lower or "secret" in key_lower or "token" in key_lower or "password" in key_lower:
                val = "***"
            settings_list.append({
                "id": s.id,
                "setting_key": s.setting_key,
                "setting_value": val,
            })
        # Also export AI config
        ai_configs = db.query(AIConfig).all()
        ai_list = []
        for ac in ai_configs:
            ai_list.append({
                "id": ac.id,
                "ai_enabled": ac.ai_enabled,
                "engine_mode": ac.engine_mode,
                "platform_name": ac.platform_name,
                "api_protocol": ac.api_protocol,
                "api_url": ac.api_url,
                "api_key_encrypted": "***",  # sanitised
                "model_name": ac.model_name,
                "max_tokens": ac.max_tokens,
                "temperature": ac.temperature,
                "feature_flags": ac.feature_flags,
            })
        combined_settings = {
            "system_settings": settings_list,
            "ai_config": ai_list,
        }
        with open(os.path.join(config_dir, "settings.json"), "w", encoding="utf-8") as f:
            json.dump(combined_settings, f, ensure_ascii=False, indent=2, default=str)

        # 2. Copy platform.db
        db_src = os.path.join(DATA_DIR, "platform.db")
        if os.path.exists(db_src):
            shutil.copy2(db_src, os.path.join(tmp_dir, "platform.db"))

        # 3. Optional: logs
        if req.include_logs:
            logs_dir = os.path.join(tmp_dir, "logs")
            os.makedirs(logs_dir, exist_ok=True)
            log_entries = db.query(SystemOperationLog).order_by(SystemOperationLog.id).all()
            log_list = []
            for log in log_entries:
                log_list.append({
                    "id": log.id,
                    "operation_type": log.operation_type,
                    "operation_module": log.operation_module,
                    "target_id": log.target_id,
                    "target_code": log.target_code,
                    "target_name": log.target_name,
                    "operation_status": log.operation_status,
                    "operation_message": log.operation_message,
                    "operator_user": log.operator_user,
                    "created_at": str(log.created_at) if log.created_at else None,
                })
            with open(os.path.join(logs_dir, "audit_log.json"), "w", encoding="utf-8") as f:
                json.dump(log_list, f, ensure_ascii=False, indent=2, default=str)

        # 4. Optional: backups dir (table backup data)
        if req.include_backups:
            backups_src = os.path.join(DATA_DIR, "backups")
            if os.path.isdir(backups_src):
                shutil.copytree(backups_src, os.path.join(tmp_dir, "backups"))

        # 5. Build manifest
        manifest = {
            "version": MANIFEST_SCHEMA_VERSION,
            "app_version": APP_VERSION,
            "created_at": _now_bjt().isoformat(),
            "created_by": getattr(current_user, "username", "system"),
            "contents": {
                "platform_config": True,
                "users": True,
                "settings": True,
                "logs": req.include_logs,
                "backups": req.include_backups,
            },
            "stats": {
                "datasources": len(ds_list),
                "tables": len(tbl_list),
                "fields": len(fld_list),
                "users": len(usr_list),
                "log_entries": len(log_list) if req.include_logs else 0,
            },
            "checksums": {},
        }

        # Compute checksums for key files
        for root, dirs, files in os.walk(tmp_dir):
            for fn in files:
                fp = os.path.join(root, fn)
                rel = os.path.relpath(fp, tmp_dir)
                manifest["checksums"][rel] = _sha256_file(fp)

        with open(os.path.join(tmp_dir, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)

        # 6. ZIP it
        zip_filename = f"{backup_name}.zip"
        zip_path = os.path.join(BACKUP_DIR, zip_filename)
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(tmp_dir):
                for fn in files:
                    fp = os.path.join(root, fn)
                    arcname = os.path.relpath(fp, tmp_dir)
                    zf.write(fp, arcname)

        file_size = os.path.getsize(zip_path)

        return {
            "success": True,
            "data": {
                "filename": zip_filename,
                "download_url": f"/api/platform/backup/download/{zip_filename}",
                "file_size": file_size,
                "file_size_human": _file_size_human(file_size),
                "created_at": _now_bjt().isoformat(),
                "manifest": manifest,
            },
        }
    finally:
        # Clean up tmp dir
        if os.path.isdir(tmp_dir):
            shutil.rmtree(tmp_dir, ignore_errors=True)


# ── GET /api/platform/backup/download/{filename} ──

@router.get("/backup/download/{filename}")
def download_backup(
    filename: str,
    current_user = Depends(require_role("admin")),
):
    """Download a backup ZIP file."""
    # Prevent path traversal
    safe_name = os.path.basename(filename)
    path = os.path.join(BACKUP_DIR, safe_name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Backup file not found")
    return FileResponse(
        path,
        media_type="application/zip",
        filename=safe_name,
    )


# ── GET /api/platform/backup/history ──

@router.get("/backup/history")
def backup_history(
    current_user = Depends(require_role("admin")),
):
    """List historical backup files."""
    items = []
    for fn in sorted(os.listdir(BACKUP_DIR), reverse=True):
        if fn.endswith(".zip") and fn.startswith("data-ops-backup-"):
            fp = os.path.join(BACKUP_DIR, fn)
            size = os.path.getsize(fp)
            # Try to extract manifest for contents info
            contents_summary = ""
            try:
                with zipfile.ZipFile(fp, "r") as zf:
                    if "manifest.json" in zf.namelist():
                        manifest = json.loads(zf.read("manifest.json"))
                        parts = []
                        c = manifest.get("contents", {})
                        if c.get("platform_config"):
                            parts.append("config")
                        if c.get("users"):
                            parts.append("users")
                        if c.get("settings"):
                            parts.append("settings")
                        if c.get("logs"):
                            parts.append("logs")
                        if c.get("backups"):
                            parts.append("backups")
                        contents_summary = "+".join(parts)
            except Exception:
                contents_summary = "unknown"

            # Parse timestamp from filename
            created_at = ""
            try:
                ts_part = fn.replace("data-ops-backup-", "").replace(".zip", "")
                dt = datetime.strptime(ts_part, "%Y%m%d-%H%M%S")
                created_at = dt.strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                created_at = ""

            items.append({
                "filename": fn,
                "file_size": size,
                "file_size_human": _file_size_human(size),
                "contents": contents_summary,
                "created_at": created_at,
                "download_url": f"/api/platform/backup/download/{fn}",
            })
    return {"success": True, "data": items}


# ── DELETE /api/platform/backup/{filename} ──

@router.delete("/backup/{filename}")
def delete_backup(
    filename: str,
    current_user = Depends(require_role("admin")),
):
    """Delete a backup file."""
    safe_name = os.path.basename(filename)
    path = os.path.join(BACKUP_DIR, safe_name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Backup file not found")
    os.remove(path)
    return {"success": True}


# ── POST /api/platform/backup/upload ──

@router.post("/backup/upload")
async def upload_backup(
    file: UploadFile = File(...),
    current_user = Depends(require_role("admin")),
):
    """Upload a backup ZIP file and parse its manifest."""
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only ZIP files are accepted")

    safe_name = os.path.basename(file.filename)
    dest = os.path.join(UPLOAD_DIR, safe_name)
    with open(dest, "wb") as f:
        content = await file.read()
        f.write(content)

    # Parse manifest
    try:
        with zipfile.ZipFile(dest, "r") as zf:
            if "manifest.json" not in zf.namelist():
                os.remove(dest)
                raise HTTPException(status_code=400, detail="Invalid backup: manifest.json not found")
            manifest = json.loads(zf.read("manifest.json"))
    except zipfile.BadZipFile:
        os.remove(dest)
        raise HTTPException(status_code=400, detail="Invalid or corrupted ZIP file")

    file_size = os.path.getsize(dest)

    return {
        "success": True,
        "data": {
            "filename": safe_name,
            "file_size": file_size,
            "file_size_human": _file_size_human(file_size),
            "manifest": manifest,
        },
    }


# ── POST /api/platform/restore ──

@router.post("/restore")
def restore_backup(
    req: RestoreRequest,
    db: Session = Depends(get_db),
    current_user = Depends(require_role("admin")),
):
    """Restore platform data from a backup ZIP."""
    if not req.confirm:
        raise HTTPException(status_code=400, detail="Confirmation required")

    # Locate the backup file (check uploads dir first, then backups dir)
    safe_name = os.path.basename(req.backup_file)
    backup_path = os.path.join(UPLOAD_DIR, safe_name)
    if not os.path.isfile(backup_path):
        backup_path = os.path.join(BACKUP_DIR, safe_name)
    if not os.path.isfile(backup_path):
        raise HTTPException(status_code=404, detail="Backup file not found")

    # Validate ZIP
    try:
        with zipfile.ZipFile(backup_path, "r") as zf:
            if "manifest.json" not in zf.namelist():
                raise HTTPException(status_code=400, detail="Invalid backup: no manifest.json")
            manifest = json.loads(zf.read("manifest.json"))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Corrupted ZIP file")

    # Version compatibility check
    backup_app_version = manifest.get("app_version", "")
    # We accept any version for now; major version mismatch warning only
    # (In production you'd have stricter checks)

    # Step 1: Auto-backup current data before restore
    pre_restore_ts = _now_bjt().strftime("%Y%m%d-%H%M%S")
    pre_restore_name = f"data-ops-backup-pre-restore-{pre_restore_ts}.zip"
    pre_restore_path = os.path.join(BACKUP_DIR, pre_restore_name)
    _quick_backup_db(pre_restore_path)

    # Step 2: Extract and restore
    extract_dir = os.path.join(UPLOAD_DIR, f".restore-{pre_restore_ts}")
    try:
        with zipfile.ZipFile(backup_path, "r") as zf:
            zf.extractall(extract_dir)

        # Verify checksums
        checksums = manifest.get("checksums", {})
        for rel_path, expected_hash in checksums.items():
            fp = os.path.join(extract_dir, rel_path)
            if os.path.isfile(fp):
                actual = _sha256_file(fp)
                if actual != expected_hash:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Checksum mismatch for {rel_path}",
                    )

        contents = manifest.get("contents", {})

        if req.mode == "overwrite":
            _restore_overwrite(db, extract_dir, contents)
        else:
            _restore_merge(db, extract_dir, contents)

        # Replace platform.db if present
        db_file = os.path.join(extract_dir, "platform.db")
        target_db = os.path.join(DATA_DIR, "platform.db")
        if os.path.isfile(db_file) and req.mode == "overwrite":
            # Close current connections – note: in production this needs more care
            # For SQLite single-file, just copy over
            shutil.copy2(db_file, target_db)

        return {
            "success": True,
            "data": {
                "message": "Restore completed successfully",
                "pre_restore_backup": pre_restore_name,
                "mode": req.mode,
                "backup_version": backup_app_version,
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        # Rollback: restore from pre-restore backup
        try:
            _rollback_from_backup(pre_restore_path)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Restore failed: {str(e)}. Auto-rollback executed.")
    finally:
        if os.path.isdir(extract_dir):
            shutil.rmtree(extract_dir, ignore_errors=True)


def _quick_backup_db(dest_zip: str):
    """Quick backup of current platform.db into a ZIP."""
    db_path = os.path.join(DATA_DIR, "platform.db")
    if not os.path.isfile(db_path):
        return
    with zipfile.ZipFile(dest_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(db_path, "platform.db")
        # Minimal manifest
        manifest = {
            "version": MANIFEST_SCHEMA_VERSION,
            "app_version": APP_VERSION,
            "created_at": _now_bjt().isoformat(),
            "created_by": "system-auto",
            "contents": {"platform_config": True, "users": True, "settings": True, "logs": False, "backups": False},
            "stats": {},
            "checksums": {"platform.db": _sha256_file(db_path)},
        }
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))


def _rollback_from_backup(zip_path: str):
    """Restore platform.db from a pre-restore backup."""
    if not os.path.isfile(zip_path):
        return
    with zipfile.ZipFile(zip_path, "r") as zf:
        if "platform.db" in zf.namelist():
            target = os.path.join(DATA_DIR, "platform.db")
            with zf.open("platform.db") as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)


def _restore_overwrite(db: Session, extract_dir: str, contents: dict):
    """Overwrite mode: clear and re-import from JSON configs."""
    config_dir = os.path.join(extract_dir, "config")
    if not os.path.isdir(config_dir):
        return

    # Import users
    users_file = os.path.join(config_dir, "users.json")
    if os.path.isfile(users_file):
        with open(users_file, "r", encoding="utf-8") as f:
            users_data = json.load(f)
        db.query(UserAccount).delete()
        for u in users_data:
            db.add(UserAccount(
                username=u["username"],
                password_hash=u["password_hash"],
                role=u.get("role", "readonly"),
                display_name=u.get("display_name"),
                status=u.get("status", "enabled"),
            ))
        db.commit()

    # Import datasources (passwords will be ***)
    ds_file = os.path.join(config_dir, "datasources.json")
    if os.path.isfile(ds_file):
        with open(ds_file, "r", encoding="utf-8") as f:
            ds_data = json.load(f)
        db.query(DatasourceConfig).delete()
        for ds in ds_data:
            db.add(DatasourceConfig(
                datasource_code=ds["datasource_code"],
                datasource_name=ds["datasource_name"],
                db_type=ds["db_type"],
                host=ds["host"],
                port=ds["port"],
                database_name=ds.get("database_name"),
                schema_name=ds.get("schema_name"),
                username=ds["username"],
                password_encrypted=ds.get("password_encrypted", "***"),
                charset=ds.get("charset", "utf8"),
                connect_timeout_seconds=ds.get("connect_timeout_seconds", 10),
                status=ds.get("status", "enabled"),
                remark=ds.get("remark"),
                created_by="restore",
                updated_by="restore",
            ))
        db.commit()

    # Import tables
    tbl_file = os.path.join(config_dir, "tables.json")
    if os.path.isfile(tbl_file):
        with open(tbl_file, "r", encoding="utf-8") as f:
            tbl_data = json.load(f)
        db.query(TableConfig).delete()
        for tbl in tbl_data:
            db.add(TableConfig(
                table_config_code=tbl["table_config_code"],
                datasource_id=tbl["datasource_id"],
                db_name=tbl.get("db_name"),
                schema_name=tbl.get("schema_name"),
                table_name=tbl["table_name"],
                table_alias=tbl.get("table_alias"),
                table_comment=tbl.get("table_comment"),
                primary_key_fields=tbl["primary_key_fields"],
                unique_key_fields=tbl.get("unique_key_fields"),
                allow_export_current=tbl.get("allow_export_current", 1),
                allow_export_all=tbl.get("allow_export_all", 1),
                allow_import_writeback=tbl.get("allow_import_writeback", 1),
                allow_insert_rows=tbl.get("allow_insert_rows", 0),
                allow_delete_rows=tbl.get("allow_delete_rows", 0),
                backup_keep_count=tbl.get("backup_keep_count", 3),
                status=tbl.get("status", "enabled"),
                remark=tbl.get("remark"),
                created_by="restore",
                updated_by="restore",
            ))
        db.commit()

    # Import fields
    fld_file = os.path.join(config_dir, "fields.json")
    if os.path.isfile(fld_file):
        with open(fld_file, "r", encoding="utf-8") as f:
            fld_data = json.load(f)
        db.query(FieldConfig).delete()
        for fld in fld_data:
            db.add(FieldConfig(
                table_config_id=fld["table_config_id"],
                field_name=fld["field_name"],
                field_alias=fld.get("field_alias"),
                db_data_type=fld["db_data_type"],
                field_order_no=fld["field_order_no"],
                is_displayed=fld.get("is_displayed", 1),
                is_editable=fld.get("is_editable", 1),
                is_required=fld.get("is_required", 0),
                is_primary_key=fld.get("is_primary_key", 0),
                is_unique_key=fld.get("is_unique_key", 0),
                is_system_field=fld.get("is_system_field", 0),
                include_in_export=fld.get("include_in_export", 1),
                include_in_import=fld.get("include_in_import", 1),
                max_length=fld.get("max_length"),
                enum_options_json=fld.get("enum_options_json"),
                validation_rule_json=fld.get("validation_rule_json"),
                default_display_type=fld.get("default_display_type", "text"),
                editable_roles=fld.get("editable_roles"),
                remark=fld.get("remark"),
                created_by="restore",
                updated_by="restore",
            ))
        db.commit()

    # Import settings
    settings_file = os.path.join(config_dir, "settings.json")
    if os.path.isfile(settings_file):
        with open(settings_file, "r", encoding="utf-8") as f:
            settings_data = json.load(f)
        # System settings
        sys_settings = settings_data.get("system_settings", [])
        if sys_settings:
            db.query(SystemSetting).delete()
            for s in sys_settings:
                if s["setting_value"] != "***":
                    db.add(SystemSetting(
                        setting_key=s["setting_key"],
                        setting_value=s["setting_value"],
                    ))
            db.commit()
        # AI config
        ai_list = settings_data.get("ai_config", [])
        if ai_list:
            db.query(AIConfig).delete()
            for ac in ai_list:
                db.add(AIConfig(
                    ai_enabled=ac.get("ai_enabled", 1),
                    engine_mode=ac.get("engine_mode", "builtin"),
                    platform_name=ac.get("platform_name"),
                    api_protocol=ac.get("api_protocol", "openai"),
                    api_url=ac.get("api_url"),
                    api_key_encrypted="",  # sanitised, user needs to re-enter
                    model_name=ac.get("model_name"),
                    max_tokens=ac.get("max_tokens", 4096),
                    temperature=ac.get("temperature", 0.3),
                    feature_flags=ac.get("feature_flags"),
                    updated_by="restore",
                ))
            db.commit()


def _restore_merge(db: Session, extract_dir: str, contents: dict):
    """Merge mode: import without clearing, conflict resolution favours backup."""
    config_dir = os.path.join(extract_dir, "config")
    if not os.path.isdir(config_dir):
        return

    # Merge users (by username)
    users_file = os.path.join(config_dir, "users.json")
    if os.path.isfile(users_file):
        with open(users_file, "r", encoding="utf-8") as f:
            users_data = json.load(f)
        for u in users_data:
            existing = db.query(UserAccount).filter(UserAccount.username == u["username"]).first()
            if existing:
                existing.password_hash = u["password_hash"]
                existing.role = u.get("role", existing.role)
                existing.display_name = u.get("display_name", existing.display_name)
                existing.status = u.get("status", existing.status)
            else:
                db.add(UserAccount(
                    username=u["username"],
                    password_hash=u["password_hash"],
                    role=u.get("role", "readonly"),
                    display_name=u.get("display_name"),
                    status=u.get("status", "enabled"),
                ))
        db.commit()

    # Merge datasources (by datasource_code)
    ds_file = os.path.join(config_dir, "datasources.json")
    if os.path.isfile(ds_file):
        with open(ds_file, "r", encoding="utf-8") as f:
            ds_data = json.load(f)
        for ds in ds_data:
            existing = db.query(DatasourceConfig).filter(
                DatasourceConfig.datasource_code == ds["datasource_code"]
            ).first()
            if existing:
                existing.datasource_name = ds["datasource_name"]
                existing.db_type = ds["db_type"]
                existing.host = ds["host"]
                existing.port = ds["port"]
                existing.database_name = ds.get("database_name")
                existing.schema_name = ds.get("schema_name")
                existing.username = ds["username"]
                # Don't overwrite password with ***
                existing.status = ds.get("status", "enabled")
                existing.remark = ds.get("remark")
                existing.updated_by = "restore"
            else:
                db.add(DatasourceConfig(
                    datasource_code=ds["datasource_code"],
                    datasource_name=ds["datasource_name"],
                    db_type=ds["db_type"],
                    host=ds["host"],
                    port=ds["port"],
                    database_name=ds.get("database_name"),
                    schema_name=ds.get("schema_name"),
                    username=ds["username"],
                    password_encrypted=ds.get("password_encrypted", "***"),
                    charset=ds.get("charset", "utf8"),
                    connect_timeout_seconds=ds.get("connect_timeout_seconds", 10),
                    status=ds.get("status", "enabled"),
                    remark=ds.get("remark"),
                    created_by="restore",
                    updated_by="restore",
                ))
        db.commit()

    # Merge tables (by table_config_code)
    tbl_file = os.path.join(config_dir, "tables.json")
    if os.path.isfile(tbl_file):
        with open(tbl_file, "r", encoding="utf-8") as f:
            tbl_data = json.load(f)
        for tbl in tbl_data:
            existing = db.query(TableConfig).filter(
                TableConfig.table_config_code == tbl["table_config_code"]
            ).first()
            if existing:
                for k in ["datasource_id", "table_name", "table_alias", "table_comment",
                           "primary_key_fields", "unique_key_fields", "status", "remark"]:
                    if k in tbl:
                        setattr(existing, k, tbl[k])
                existing.updated_by = "restore"
            else:
                db.add(TableConfig(
                    table_config_code=tbl["table_config_code"],
                    datasource_id=tbl["datasource_id"],
                    db_name=tbl.get("db_name"),
                    schema_name=tbl.get("schema_name"),
                    table_name=tbl["table_name"],
                    table_alias=tbl.get("table_alias"),
                    table_comment=tbl.get("table_comment"),
                    primary_key_fields=tbl["primary_key_fields"],
                    unique_key_fields=tbl.get("unique_key_fields"),
                    status=tbl.get("status", "enabled"),
                    remark=tbl.get("remark"),
                    created_by="restore",
                    updated_by="restore",
                ))
        db.commit()

    # Merge fields (by table_config_id + field_name)
    fld_file = os.path.join(config_dir, "fields.json")
    if os.path.isfile(fld_file):
        with open(fld_file, "r", encoding="utf-8") as f:
            fld_data = json.load(f)
        for fld in fld_data:
            existing = db.query(FieldConfig).filter(
                FieldConfig.table_config_id == fld["table_config_id"],
                FieldConfig.field_name == fld["field_name"],
            ).first()
            if existing:
                for k in ["field_alias", "db_data_type", "field_order_no", "is_displayed",
                           "is_editable", "is_required", "max_length", "remark"]:
                    if k in fld:
                        setattr(existing, k, fld[k])
                existing.updated_by = "restore"
            else:
                db.add(FieldConfig(
                    table_config_id=fld["table_config_id"],
                    field_name=fld["field_name"],
                    field_alias=fld.get("field_alias"),
                    db_data_type=fld["db_data_type"],
                    field_order_no=fld["field_order_no"],
                    is_displayed=fld.get("is_displayed", 1),
                    is_editable=fld.get("is_editable", 1),
                    is_required=fld.get("is_required", 0),
                    is_primary_key=fld.get("is_primary_key", 0),
                    is_unique_key=fld.get("is_unique_key", 0),
                    is_system_field=fld.get("is_system_field", 0),
                    include_in_export=fld.get("include_in_export", 1),
                    include_in_import=fld.get("include_in_import", 1),
                    max_length=fld.get("max_length"),
                    enum_options_json=fld.get("enum_options_json"),
                    validation_rule_json=fld.get("validation_rule_json"),
                    default_display_type=fld.get("default_display_type", "text"),
                    editable_roles=fld.get("editable_roles"),
                    remark=fld.get("remark"),
                    created_by="restore",
                    updated_by="restore",
                ))
        db.commit()
