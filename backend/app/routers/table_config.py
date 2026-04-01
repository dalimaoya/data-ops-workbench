"""Table config management: CRUD, remote table listing, structure check."""

from __future__ import annotations
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import TableConfig, DatasourceConfig, FieldConfig, _now_bjt
from app.schemas.table_config import (
    TableConfigCreate, TableConfigUpdate, TableConfigOut,
    RemoteTablesResponse, RemoteTableInfo,
    StructureCheckResponse, SampleDataResponse,
)
from app.utils.crypto import decrypt_password
from app.utils.remote_db import list_tables, list_columns, fetch_sample_data, compute_structure_hash
from app.ai.rules_engine import suggest_semantic_name, is_system_field
from app.utils.audit import log_operation
from app.utils.auth import get_current_user, require_role
from app.utils.permissions import get_permitted_datasource_ids
from app.models import UserAccount
from app.i18n import t

router = APIRouter(prefix="/api/table-config", tags=["纳管表配置"])


def _gen_code(db: Session) -> str:
    today = _now_bjt().strftime("%Y%m%d")
    prefix = f"TB_{today}_"
    last = (
        db.query(TableConfig)
        .filter(TableConfig.table_config_code.like(f"{prefix}%"))
        .order_by(TableConfig.id.desc())
        .first()
    )
    seq = 1
    if last:
        try:
            seq = int(last.table_config_code.split("_")[-1]) + 1
        except ValueError:
            pass
    return f"{prefix}{seq:03d}"


def _get_ds(db: Session, ds_id: int, user: UserAccount = None) -> DatasourceConfig:
    # Check datasource-level permission if user provided
    if user is not None:
        permitted_ids = get_permitted_datasource_ids(db, user)
        if permitted_ids is not None and ds_id not in permitted_ids:
            raise HTTPException(403, t("datasource.not_found"))
    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == ds_id, DatasourceConfig.is_deleted == 0
    ).first()
    if not ds:
        raise HTTPException(404, t("datasource.not_found"))
    return ds


# ── List remote tables ──
@router.get("/remote-tables/{ds_id}", response_model=RemoteTablesResponse)
def get_remote_tables(
    ds_id: int,
    db_name: Optional[str] = None,
    schema_name: Optional[str] = None,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    """获取远程数据库的库表清单。"""
    ds = _get_ds(db, ds_id, user)
    pwd = decrypt_password(ds.password_encrypted)
    use_db = db_name or ds.database_name
    use_schema = schema_name or ds.schema_name
    try:
        tables = list_tables(
            db_type=ds.db_type, host=ds.host, port=ds.port,
            user=ds.username, password=pwd,
            database=use_db, schema=use_schema,
            charset=ds.charset, timeout=ds.connect_timeout_seconds or 10,
        )
    except Exception as e:
        raise HTTPException(400, t("table_config.datasource_connect_failed", error=str(e)))
    return RemoteTablesResponse(
        datasource_id=ds_id,
        db_name=use_db,
        schema_name=use_schema,
        tables=[RemoteTableInfo(table_name=t["table_name"], table_comment=t.get("table_comment")) for t in tables],
    )


# ── Preview remote table columns + sample data (for create wizard) ──
@router.get("/remote-preview/{ds_id}")
def preview_remote_table(
    ds_id: int,
    table_name: str = Query(...),
    db_name: Optional[str] = None,
    schema_name: Optional[str] = None,
    sample_limit: int = Query(5, ge=1, le=20),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    """获取远程表的字段列表和示例数据（用于新增纳管表向导）。"""
    ds = _get_ds(db, ds_id, user)
    pwd = decrypt_password(ds.password_encrypted)
    use_db = db_name or ds.database_name
    use_schema = schema_name or ds.schema_name
    try:
        columns = list_columns(
            db_type=ds.db_type, host=ds.host, port=ds.port,
            user=ds.username, password=pwd,
            table_name=table_name,
            database=use_db, schema=use_schema,
            charset=ds.charset, timeout=ds.connect_timeout_seconds or 10,
        )
    except Exception as e:
        raise HTTPException(400, t("table_config.datasource_connect_failed", error=str(e)))
    try:
        col_names, sample_rows = fetch_sample_data(
            db_type=ds.db_type, host=ds.host, port=ds.port,
            user=ds.username, password=pwd,
            table_name=table_name,
            database=use_db, schema=use_schema,
            charset=ds.charset, timeout=ds.connect_timeout_seconds or 10,
            limit=sample_limit,
        )
    except Exception:
        col_names, sample_rows = [], []
    # Normalize column field names for frontend (column_name, data_type)
    normalized_columns = []
    for c in columns:
        normalized_columns.append({
            "column_name": c.get("field_name") or c.get("column_name", ""),
            "data_type": c.get("db_data_type") or c.get("data_type", ""),
            "column_type": c.get("db_data_type") or c.get("column_type", ""),
            "is_nullable": c.get("is_nullable", True),
            "column_default": c.get("column_default"),
            "ordinal_position": c.get("ordinal_position", 0),
            "is_primary_key": c.get("is_primary_key", False),
        })
    return {
        "columns": normalized_columns,
        "sample_columns": col_names,
        "sample_rows": sample_rows,
    }


# ── List table configs ──
@router.get("", response_model=List[TableConfigOut])
def list_table_configs(
    datasource_id: Optional[int] = None,
    db_name: Optional[str] = None,
    status: Optional[str] = None,
    keyword: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=500),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    q = db.query(TableConfig).filter(TableConfig.is_deleted == 0)
    # v2.2: datasource-level permission filtering
    permitted_ids = get_permitted_datasource_ids(db, user)
    if permitted_ids is not None:
        if not permitted_ids:
            return []
        q = q.filter(TableConfig.datasource_id.in_(permitted_ids))
    if datasource_id:
        q = q.filter(TableConfig.datasource_id == datasource_id)
    if db_name:
        q = q.filter(TableConfig.db_name == db_name)
    if status:
        q = q.filter(TableConfig.status == status)
    if keyword:
        q = q.filter(
            (TableConfig.table_name.contains(keyword)) |
            (TableConfig.table_alias.contains(keyword))
        )
    rows = q.order_by(TableConfig.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    # Enrich with datasource info and field count
    result = []
    for row in rows:
        out = TableConfigOut.model_validate(row)
        ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == row.datasource_id).first()
        if ds:
            out.datasource_name = ds.datasource_name
            out.db_type = ds.db_type
        out.field_count = db.query(FieldConfig).filter(
            FieldConfig.table_config_id == row.id, FieldConfig.is_deleted == 0
        ).count()
        result.append(out)
    return result


@router.get("/count")
def count_table_configs(
    datasource_id: Optional[int] = None,
    db_name: Optional[str] = None,
    status: Optional[str] = None,
    keyword: Optional[str] = None,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    q = db.query(TableConfig).filter(TableConfig.is_deleted == 0)
    permitted_ids = get_permitted_datasource_ids(db, user)
    if permitted_ids is not None:
        if not permitted_ids:
            return {"total": 0}
        q = q.filter(TableConfig.datasource_id.in_(permitted_ids))
    if datasource_id:
        q = q.filter(TableConfig.datasource_id == datasource_id)
    if db_name:
        q = q.filter(TableConfig.db_name == db_name)
    if status:
        q = q.filter(TableConfig.status == status)
    if keyword:
        q = q.filter(
            (TableConfig.table_name.contains(keyword)) |
            (TableConfig.table_alias.contains(keyword))
        )
    return {"total": q.count()}


# ── Get single table config ──
@router.get("/{tc_id}", response_model=TableConfigOut)
def get_table_config(tc_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = db.query(TableConfig).filter(
        TableConfig.id == tc_id, TableConfig.is_deleted == 0
    ).first()
    if not row:
        raise HTTPException(404, t("table_config.not_found"))
    out = TableConfigOut.model_validate(row)
    ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == row.datasource_id).first()
    if ds:
        out.datasource_name = ds.datasource_name
        out.db_type = ds.db_type
    out.field_count = db.query(FieldConfig).filter(
        FieldConfig.table_config_id == row.id, FieldConfig.is_deleted == 0
    ).count()
    return out


# ── Create table config ──
@router.post("", response_model=TableConfigOut)
def create_table_config(body: TableConfigCreate, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    ds = _get_ds(db, body.datasource_id, user)

    # Check duplicate
    existing = db.query(TableConfig).filter(
        TableConfig.datasource_id == body.datasource_id,
        TableConfig.db_name == (body.db_name or ds.database_name),
        TableConfig.table_name == body.table_name,
        TableConfig.is_deleted == 0,
    ).first()
    if existing:
        raise HTTPException(409, t("table_config.already_managed"))

    # Fetch columns to compute initial hash
    pwd = decrypt_password(ds.password_encrypted)
    use_db = body.db_name or ds.database_name
    use_schema = body.schema_name or ds.schema_name
    try:
        columns = list_columns(
            db_type=ds.db_type, host=ds.host, port=ds.port,
            user=ds.username, password=pwd,
            table_name=body.table_name,
            database=use_db, schema=use_schema,
            charset=ds.charset, timeout=ds.connect_timeout_seconds or 10,
        )
    except Exception as e:
        raise HTTPException(500, t("table_config.fetch_columns_failed", error=str(e)))

    structure_hash = compute_structure_hash(columns)

    row = TableConfig(
        table_config_code=_gen_code(db),
        datasource_id=body.datasource_id,
        db_name=use_db,
        schema_name=use_schema,
        table_name=body.table_name,
        table_alias=body.table_alias if (body.table_alias and body.table_alias != body.table_name) else (suggest_semantic_name(body.table_name) or body.table_alias or body.table_name),
        table_comment=body.table_comment,
        config_version=1,
        structure_version_hash=structure_hash,
        primary_key_fields=body.primary_key_fields,
        unique_key_fields=body.unique_key_fields,
        allow_export_current=body.allow_export_current,
        allow_export_all=body.allow_export_all,
        allow_import_writeback=body.allow_import_writeback,
        allow_insert_rows=body.allow_insert_rows,
        allow_delete_rows=body.allow_delete_rows,
        template_reserved_blank_rows=body.template_reserved_blank_rows,
        backup_keep_count=body.backup_keep_count,
        strict_template_version=body.strict_template_version,
        strict_field_order=body.strict_field_order,
        status="enabled",
        structure_check_status="normal",
        last_structure_check_at=_now_bjt(),
        last_sync_at=_now_bjt(),
        created_by=user.username,
        updated_by=user.username,
    )
    db.add(row)
    db.flush()

    # Fetch sample data to populate sample_value
    try:
        col_names, sample_rows = fetch_sample_data(
            db_type=ds.db_type, host=ds.host, port=ds.port,
            user=ds.username, password=pwd,
            table_name=body.table_name,
            database=use_db, schema=use_schema,
            charset=ds.charset, timeout=ds.connect_timeout_seconds or 10,
            limit=5,
        )
        sample_map = {}
        if sample_rows:
            for i, cn in enumerate(col_names):
                for sr in sample_rows:
                    if sr[i] is not None:
                        sample_map[cn] = sr[i]
                        break
        for col in columns:
            col["sample_value"] = sample_map.get(col["field_name"])
    except Exception:
        pass  # sample_value is optional, don't block creation

    # Auto-create field configs
    _auto_generate_fields(db, row.id, columns, body.primary_key_fields, operator_name=user.username)

    log_operation(db, "纳管表配置", "创建纳管表", "success",
                  target_id=row.id, target_code=row.table_config_code,
                  target_name=row.table_name,
                  message=f"创建纳管表 {row.table_alias or row.table_name}",
                  operator=user.username)

    db.commit()
    db.refresh(row)
    out = TableConfigOut.model_validate(row)
    out.datasource_name = ds.datasource_name
    out.db_type = ds.db_type
    out.field_count = len(columns)
    return out


def _merge_fields(db: Session, table_config_id: int, columns: list, pk_fields_str: str, operator_name: str = "system"):
    """Merge remote columns into existing field configs, preserving user customizations."""
    pk_set = set(f.strip() for f in pk_fields_str.split(","))
    system_keywords = {"created_at", "updated_at", "created_by", "updated_by", "is_deleted",
                       "create_time", "update_time", "create_by", "update_by", "gmt_create", "gmt_modified"}

    existing_fields = db.query(FieldConfig).filter(
        FieldConfig.table_config_id == table_config_id,
        FieldConfig.is_deleted == 0,
    ).all()
    existing_map = {f.field_name: f for f in existing_fields}
    remote_field_names = set()

    for col in columns:
        fname = col["field_name"]
        remote_field_names.add(fname)
        is_pk = fname in pk_set or col.get("is_primary_key", False)
        is_sys = fname.lower() in system_keywords

        if fname in existing_map:
            # Update only DB-sourced properties, keep user-customized ones
            existing = existing_map[fname]
            existing.db_data_type = col["db_data_type"]
            existing.field_order_no = col.get("ordinal_position", 0)
            existing.is_primary_key = 1 if is_pk else 0
            existing.is_system_field = 1 if is_sys else 0
            if col.get("sample_value") is not None:
                existing.sample_value = str(col["sample_value"])
            existing.updated_by = operator_name
            existing.updated_at = _now_bjt()
        else:
            # New field — create with defaults
            fc = FieldConfig(
                table_config_id=table_config_id,
                field_name=fname,
                field_alias=fname,
                db_data_type=col["db_data_type"],
                field_order_no=col.get("ordinal_position", 0),
                sample_value=str(col["sample_value"]) if col.get("sample_value") is not None else None,
                is_displayed=1,
                is_editable=0 if is_pk or is_sys else 1,
                is_required=1 if is_pk else 0,
                is_primary_key=1 if is_pk else 0,
                is_unique_key=0,
                is_system_field=1 if is_sys else 0,
                include_in_export=0 if is_sys else 1,
                include_in_import=0 if is_pk or is_sys else 1,
                created_by=operator_name,
                updated_by=operator_name,
            )
            db.add(fc)

    # Soft-delete fields that no longer exist in remote
    for fname, existing in existing_map.items():
        if fname not in remote_field_names:
            existing.is_deleted = 1
            existing.updated_at = _now_bjt()


def _auto_generate_fields(db: Session, table_config_id: int, columns: list, pk_fields_str: str, operator_name: str = "system"):
    """Generate FieldConfig records from remote column info, with local AI alias suggestion."""
    pk_set = set(f.strip() for f in pk_fields_str.split(","))

    for col in columns:
        fname = col["field_name"]
        is_pk = fname in pk_set or col.get("is_primary_key", False)
        is_sys = is_system_field(fname)

        # Local rule-based alias suggestion
        alias = suggest_semantic_name(fname) or fname

        fc = FieldConfig(
            table_config_id=table_config_id,
            field_name=fname,
            field_alias=alias,
            db_data_type=col["db_data_type"],
            field_order_no=col.get("ordinal_position", 0),
            sample_value=col.get("sample_value"),
            is_displayed=1,
            is_editable=0 if is_pk or is_sys else 1,
            is_required=1 if is_pk else 0,
            is_primary_key=1 if is_pk else 0,
            is_unique_key=0,
            is_system_field=1 if is_sys else 0,
            include_in_export=0 if is_sys else 1,
            include_in_import=0 if is_pk or is_sys else 1,
            created_by=operator_name,
            updated_by=operator_name,
        )
        db.add(fc)


# ── Update table config ──
@router.put("/{tc_id}", response_model=TableConfigOut)
def update_table_config(tc_id: int, body: TableConfigUpdate, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    row = db.query(TableConfig).filter(
        TableConfig.id == tc_id, TableConfig.is_deleted == 0
    ).first()
    if not row:
        raise HTTPException(404, t("table_config.not_found"))
    updates = body.model_dump(exclude_unset=True)
    for k, v in updates.items():
        setattr(row, k, v)
    row.updated_by = user.username
    row.updated_at = _now_bjt()
    row.config_version = row.config_version + 1
    log_operation(db, "纳管表配置", "编辑纳管表", "success",
                  target_id=row.id, target_code=row.table_config_code,
                  target_name=row.table_name,
                  message=f"编辑纳管表 {row.table_alias or row.table_name}",
                  operator=user.username)
    db.commit()
    db.refresh(row)
    return _enrich_out(db, row)


# ── Delete table config ──
@router.delete("/{tc_id}")
def delete_table_config(tc_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    row = db.query(TableConfig).filter(
        TableConfig.id == tc_id, TableConfig.is_deleted == 0
    ).first()
    if not row:
        raise HTTPException(404, t("table_config.not_found"))
    row.is_deleted = 1
    row.updated_at = _now_bjt()
    # Also soft-delete fields
    db.query(FieldConfig).filter(FieldConfig.table_config_id == tc_id).update(
        {"is_deleted": 1}, synchronize_session=False
    )
    log_operation(db, "纳管表配置", "删除纳管表", "success",
                  target_id=row.id, target_code=row.table_config_code,
                  target_name=row.table_name,
                  message=f"删除纳管表 {row.table_alias or row.table_name}",
                  operator=user.username)
    db.commit()
    return {"detail": t("table_config.deleted")}


# ── Structure check ──
@router.post("/{tc_id}/check-structure", response_model=StructureCheckResponse)
def check_structure(tc_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    """检测表结构变化：对比远程当前结构 hash 与已保存 hash。"""
    row = db.query(TableConfig).filter(
        TableConfig.id == tc_id, TableConfig.is_deleted == 0
    ).first()
    if not row:
        raise HTTPException(404, t("table_config.not_found"))
    ds = _get_ds(db, row.datasource_id, user)
    pwd = decrypt_password(ds.password_encrypted)
    try:
        columns = list_columns(
            db_type=ds.db_type, host=ds.host, port=ds.port,
            user=ds.username, password=pwd,
            table_name=row.table_name,
            database=row.db_name, schema=row.schema_name,
            charset=ds.charset, timeout=ds.connect_timeout_seconds or 10,
        )
    except Exception as e:
        row.structure_check_status = "error"
        row.last_structure_check_at = _now_bjt()
        db.commit()
        return StructureCheckResponse(
            status="error", message=t("table_config.remote_db_error", error=str(e)),
            current_hash=None, saved_hash=row.structure_version_hash,
        )

    current_hash = compute_structure_hash(columns)
    saved_hash = row.structure_version_hash

    if current_hash == saved_hash:
        row.structure_check_status = "normal"
        row.last_structure_check_at = _now_bjt()
        log_operation(db, "纳管表配置", "结构检测", "success",
                      target_id=row.id, target_name=row.table_name,
                      message="表结构未发生变化",
                      operator=user.username)
        db.commit()
        return StructureCheckResponse(
            status="normal", message=t("table_config.structure_normal"),
            current_hash=current_hash, saved_hash=saved_hash,
        )
    else:
        row.structure_check_status = "changed"
        row.last_structure_check_at = _now_bjt()
        log_operation(db, "纳管表配置", "结构检测", "warning",
                      target_id=row.id, target_name=row.table_name,
                      message="表结构已发生变化",
                      operator=user.username)
        db.commit()
        return StructureCheckResponse(
            status="changed", message=t("table_config.structure_changed"),
            current_hash=current_hash, saved_hash=saved_hash,
        )


# ── Sync fields (re-pull from remote) ──
@router.post("/{tc_id}/sync-fields")
def sync_fields(tc_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(require_role("admin"))):
    """重新从远程数据库拉取字段并更新字段配置。"""
    row = db.query(TableConfig).filter(
        TableConfig.id == tc_id, TableConfig.is_deleted == 0
    ).first()
    if not row:
        raise HTTPException(404, t("table_config.not_found"))
    ds = _get_ds(db, row.datasource_id, user)
    pwd = decrypt_password(ds.password_encrypted)
    try:
        columns = list_columns(
            db_type=ds.db_type, host=ds.host, port=ds.port,
            user=ds.username, password=pwd,
            table_name=row.table_name,
            database=row.db_name, schema=row.schema_name,
            charset=ds.charset, timeout=ds.connect_timeout_seconds or 10,
        )
        # Fetch sample data
        col_names, sample_rows = fetch_sample_data(
            db_type=ds.db_type, host=ds.host, port=ds.port,
            user=ds.username, password=pwd,
            table_name=row.table_name,
            database=row.db_name, schema=row.schema_name,
            charset=ds.charset, timeout=ds.connect_timeout_seconds or 10,
            limit=5,
        )
    except Exception as e:
        raise HTTPException(500, t("table_config.fetch_fields_failed", error=str(e)))

    # Attach sample values
    sample_map = {}
    if sample_rows:
        for i, cn in enumerate(col_names):
            for sr in sample_rows:
                if sr[i] is not None:
                    sample_map[cn] = sr[i]
                    break
    for col in columns:
        col["sample_value"] = sample_map.get(col["field_name"])

    # Merge fields: preserve existing custom configs, add new, update changed
    _merge_fields(db, tc_id, columns, row.primary_key_fields, operator_name=user.username)

    # Update hash
    new_hash = compute_structure_hash(columns)
    row.structure_version_hash = new_hash
    row.structure_check_status = "normal"
    row.last_structure_check_at = _now_bjt()
    row.last_sync_at = _now_bjt()
    row.config_version = row.config_version + 1
    row.updated_at = _now_bjt()
    log_operation(db, "纳管表配置", "字段同步", "success",
                  target_id=row.id, target_name=row.table_name,
                  message=f"字段同步完成，{len(columns)} 个字段",
                  operator=user.username)
    db.commit()

    return {"detail": t("table_config.fields_synced"), "field_count": len(columns), "structure_hash": new_hash}


# ── Sample data preview ──
@router.get("/{tc_id}/sample-data", response_model=SampleDataResponse)
def get_sample_data(
    tc_id: int,
    limit: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    row = db.query(TableConfig).filter(
        TableConfig.id == tc_id, TableConfig.is_deleted == 0
    ).first()
    if not row:
        raise HTTPException(404, t("table_config.not_found"))
    ds = _get_ds(db, row.datasource_id, user)
    pwd = decrypt_password(ds.password_encrypted)
    try:
        columns, rows = fetch_sample_data(
            db_type=ds.db_type, host=ds.host, port=ds.port,
            user=ds.username, password=pwd,
            table_name=row.table_name,
            database=row.db_name, schema=row.schema_name,
            charset=ds.charset, timeout=ds.connect_timeout_seconds or 10,
            limit=limit,
        )
    except Exception as e:
        raise HTTPException(500, t("table_config.fetch_sample_failed", error=str(e)))
    return SampleDataResponse(columns=columns, rows=rows, total=len(rows))


def _enrich_out(db: Session, row: TableConfig) -> TableConfigOut:
    out = TableConfigOut.model_validate(row)
    ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == row.datasource_id).first()
    if ds:
        out.datasource_name = ds.datasource_name
        out.db_type = ds.db_type
    out.field_count = db.query(FieldConfig).filter(
        FieldConfig.table_config_id == row.id, FieldConfig.is_deleted == 0
    ).count()
    return out
