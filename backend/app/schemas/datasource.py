"""Pydantic schemas for datasource endpoints."""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class DatasourceCreate(BaseModel):
    datasource_name: str = Field(..., max_length=128)
    db_type: str = Field(..., pattern=r"^(mysql|postgresql|sqlserver|oracle|dm|kingbase|sqlite)$")
    host: str = Field("", max_length=255)
    port: int = Field(0, ge=0, le=65535)
    database_name: Optional[str] = None
    schema_name: Optional[str] = None
    username: str = Field(..., max_length=128)
    password: str = Field("", min_length=0)
    charset: Optional[str] = "utf8"
    connect_timeout_seconds: Optional[int] = 10
    status: str = "enabled"
    remark: Optional[str] = None


class DatasourceUpdate(BaseModel):
    datasource_name: Optional[str] = None
    db_type: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    database_name: Optional[str] = None
    schema_name: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    charset: Optional[str] = None
    connect_timeout_seconds: Optional[int] = None
    status: Optional[str] = None
    remark: Optional[str] = None


class DatasourceOut(BaseModel):
    id: int
    datasource_code: str
    datasource_name: str
    db_type: str
    host: str
    port: int
    database_name: Optional[str] = None
    schema_name: Optional[str] = None
    username: str
    charset: Optional[str] = None
    connect_timeout_seconds: Optional[int] = None
    status: str
    last_test_status: Optional[str] = None
    last_test_message: Optional[str] = None
    last_test_at: Optional[datetime] = None
    remark: Optional[str] = None
    created_by: str
    created_at: datetime
    updated_by: str
    updated_at: datetime

    model_config = {"from_attributes": True}


class TestConnectionRequest(BaseModel):
    db_type: str
    host: str
    port: int
    database_name: Optional[str] = None
    schema_name: Optional[str] = None
    username: str
    password: str
    charset: Optional[str] = "utf8"
    connect_timeout_seconds: Optional[int] = 10


class TestConnectionResponse(BaseModel):
    success: bool
    message: str
