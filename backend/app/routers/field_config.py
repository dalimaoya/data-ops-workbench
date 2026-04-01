"""Field config CRUD endpoints."""

from __future__ import annotations
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import FieldConfig, TableConfig, UserAccount, _now_bjt
from app.schemas.table_config import FieldConfigOut, FieldConfigUpdate, FieldConfigBatchUpdate
from app.utils.auth import get_current_user, require_role
from app.i18n import t

router = APIRouter(prefix="/api/field-config", tags=["字段配置"])


# ── List fields for a table config ──
@router.get("/{table_config_id}", response_model=List[FieldConfigOut])
def list_fields(
    table_config_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    tc = db.query(TableConfig).filter(
        TableConfig.id == table_config_id, TableConfig.is_deleted == 0
    ).first()
    if not tc:
        raise HTTPException(404, t("field_config.table_not_found"))
    fields = (
        db.query(FieldConfig)
        .filter(FieldConfig.table_config_id == table_config_id, FieldConfig.is_deleted == 0)
        .order_by(FieldConfig.field_order_no)
        .all()
    )
    return fields


# ── Get single field ──
@router.get("/detail/{field_id}", response_model=FieldConfigOut)
def get_field(
    field_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    row = db.query(FieldConfig).filter(
        FieldConfig.id == field_id, FieldConfig.is_deleted == 0
    ).first()
    if not row:
        raise HTTPException(404, t("field_config.not_found"))
    return row


# ── Update single field ──
@router.put("/{field_id}", response_model=FieldConfigOut)
def update_field(
    field_id: int,
    body: FieldConfigUpdate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    row = db.query(FieldConfig).filter(
        FieldConfig.id == field_id, FieldConfig.is_deleted == 0
    ).first()
    if not row:
        raise HTTPException(404, t("field_config.not_found"))
    updates = body.model_dump(exclude_unset=True)
    for k, v in updates.items():
        setattr(row, k, v)
    row.updated_by = user.username
    row.updated_at = _now_bjt()
    db.commit()
    db.refresh(row)
    return row


# ── Batch update fields ──
@router.put("/batch/update")
def batch_update_fields(
    body: FieldConfigBatchUpdate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    updates = body.updates.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, t("field_config.no_fields_to_update"))
    count = 0
    for fid in body.field_ids:
        row = db.query(FieldConfig).filter(
            FieldConfig.id == fid, FieldConfig.is_deleted == 0
        ).first()
        if row:
            for k, v in updates.items():
                setattr(row, k, v)
            row.updated_by = user.username
            row.updated_at = _now_bjt()
            count += 1
    db.commit()
    return {"detail": t("field_config.updated_count", count=count)}


# ── Delete field ──
@router.delete("/{field_id}")
def delete_field(
    field_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    row = db.query(FieldConfig).filter(
        FieldConfig.id == field_id, FieldConfig.is_deleted == 0
    ).first()
    if not row:
        raise HTTPException(404, t("field_config.not_found"))
    row.is_deleted = 1
    row.updated_at = _now_bjt()
    db.commit()
    return {"detail": t("field_config.deleted")}
