"""Pydantic schemas for table_config and field_config endpoints."""

from __future__ import annotations
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


# ── Remote table info ──
class RemoteTableInfo(BaseModel):
    table_name: str
    table_comment: Optional[str] = None
    row_count: Optional[int] = None


class RemoteTablesResponse(BaseModel):
    datasource_id: int
    db_name: Optional[str] = None
    schema_name: Optional[str] = None
    tables: List[RemoteTableInfo]


# ── Remote column info ──
class RemoteColumnInfo(BaseModel):
    field_name: str
    db_data_type: str
    is_nullable: bool = True
    column_default: Optional[str] = None
    is_primary_key: bool = False
    ordinal_position: int = 0
    sample_value: Optional[str] = None


# ── Table config CRUD ──
class TableConfigCreate(BaseModel):
    datasource_id: int
    db_name: Optional[str] = None
    schema_name: Optional[str] = None
    table_name: str = Field(..., max_length=128)
    table_alias: Optional[str] = None
    table_comment: Optional[str] = None
    primary_key_fields: str = Field(..., min_length=1, description="逗号分隔主键字段")
    unique_key_fields: Optional[str] = None
    allow_export_current: int = 1
    allow_export_all: int = 1
    allow_import_writeback: int = 1
    allow_insert_rows: int = 1
    allow_delete_rows: int = 1
    template_reserved_blank_rows: int = 200
    backup_keep_count: int = 3
    strict_template_version: int = 1
    strict_field_order: int = 1
    remark: Optional[str] = None


class TableConfigUpdate(BaseModel):
    table_alias: Optional[str] = None
    table_comment: Optional[str] = None
    primary_key_fields: Optional[str] = None
    unique_key_fields: Optional[str] = None
    allow_export_current: Optional[int] = None
    allow_export_all: Optional[int] = None
    allow_import_writeback: Optional[int] = None
    allow_insert_rows: Optional[int] = None
    allow_delete_rows: Optional[int] = None
    template_reserved_blank_rows: Optional[int] = None
    backup_keep_count: Optional[int] = None
    strict_template_version: Optional[int] = None
    strict_field_order: Optional[int] = None
    status: Optional[str] = None
    remark: Optional[str] = None


class TableConfigOut(BaseModel):
    id: int
    table_config_code: str
    datasource_id: int
    db_name: Optional[str] = None
    schema_name: Optional[str] = None
    table_name: str
    table_alias: Optional[str] = None
    table_comment: Optional[str] = None
    config_version: int
    structure_version_hash: Optional[str] = None
    primary_key_fields: str
    unique_key_fields: Optional[str] = None
    allow_export_current: int
    allow_export_all: int
    allow_import_writeback: int
    allow_insert_rows: int
    allow_delete_rows: int
    template_reserved_blank_rows: int = 200
    backup_keep_count: int
    strict_template_version: int
    strict_field_order: int
    status: str
    structure_check_status: Optional[str] = None
    last_structure_check_at: Optional[datetime] = None
    last_sync_at: Optional[datetime] = None
    remark: Optional[str] = None
    created_by: str
    created_at: datetime
    updated_by: str
    updated_at: datetime
    # joined fields
    datasource_name: Optional[str] = None
    db_type: Optional[str] = None
    field_count: Optional[int] = None

    model_config = {"from_attributes": True}


# ── Field config CRUD ──
class FieldConfigOut(BaseModel):
    id: int
    table_config_id: int
    field_name: str
    field_alias: Optional[str] = None
    db_data_type: str
    field_order_no: int
    sample_value: Optional[str] = None
    is_displayed: int
    is_editable: int
    is_required: int
    is_primary_key: int
    is_unique_key: int
    is_system_field: int
    include_in_export: int
    include_in_import: int
    max_length: Optional[int] = None
    enum_options_json: Optional[str] = None
    validation_rule_json: Optional[str] = None
    default_display_type: Optional[str] = None
    editable_roles: Optional[str] = None
    sensitivity_level: Optional[str] = None
    sensitivity_note: Optional[str] = None
    remark: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class FieldConfigUpdate(BaseModel):
    field_alias: Optional[str] = None
    is_displayed: Optional[int] = None
    is_editable: Optional[int] = None
    is_required: Optional[int] = None
    is_primary_key: Optional[int] = None
    is_unique_key: Optional[int] = None
    is_system_field: Optional[int] = None
    include_in_export: Optional[int] = None
    include_in_import: Optional[int] = None
    max_length: Optional[int] = None
    enum_options_json: Optional[str] = None
    validation_rule_json: Optional[str] = None
    default_display_type: Optional[str] = None
    editable_roles: Optional[str] = None
    remark: Optional[str] = None


class FieldConfigBatchUpdate(BaseModel):
    field_ids: List[int]
    updates: FieldConfigUpdate


class StructureCheckResponse(BaseModel):
    status: str  # normal / changed / error
    message: str
    current_hash: Optional[str] = None
    saved_hash: Optional[str] = None


class SampleDataResponse(BaseModel):
    columns: List[str]
    rows: List[List[Optional[str]]]
    total: int
