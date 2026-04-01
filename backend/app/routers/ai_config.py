"""AI configuration API routes — GET/PUT config, POST test connection, validate config."""

import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

from app.database import get_db
from app.utils.auth import get_current_user, require_role
from app.ai.ai_config import get_ai_config, update_ai_config
from app.ai.ai_client import AIClient
from app.utils.crypto import decrypt_password
from app.models import AIConfig, SystemSetting
from app.i18n import t

router = APIRouter(prefix="/api/ai", tags=["AI Configuration"])


# ── Schemas ──

class AIConfigUpdate(BaseModel):
    ai_enabled: Optional[bool] = None
    engine_mode: Optional[str] = None

    # Local model config
    local_api_protocol: Optional[str] = None
    local_api_url: Optional[str] = None
    local_api_key: Optional[str] = None  # plain text, will be encrypted
    local_model_name: Optional[str] = None
    local_max_tokens: Optional[int] = None
    local_temperature: Optional[float] = None

    # Cloud LLM config
    cloud_platform_name: Optional[str] = None
    cloud_api_protocol: Optional[str] = None
    cloud_api_url: Optional[str] = None
    cloud_api_key: Optional[str] = None  # plain text, will be encrypted
    cloud_model_name: Optional[str] = None
    cloud_max_tokens: Optional[int] = None
    cloud_temperature: Optional[float] = None

    feature_flags: Optional[dict] = None


class AITestRequest(BaseModel):
    api_protocol: Optional[str] = None
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    model_name: Optional[str] = None
    max_tokens: Optional[int] = 4096
    temperature: Optional[float] = 0.3
    test_mode: Optional[str] = None  # "local" or "cloud"


class AIValidateConfigUpdate(BaseModel):
    outlier_range: Optional[str] = None       # p1_p99 / p5_p95 / p10_p90
    history_sample_size: Optional[int] = None  # default 1000
    warning_behavior: Optional[str] = None     # warn / block
    skip_fields: Optional[List[str]] = None


class CleaningRulesUpdate(BaseModel):
    fullwidth_to_halfwidth: Optional[bool] = None
    trim_whitespace: Optional[bool] = None
    normalize_linebreaks: Optional[bool] = None
    null_standardization: Optional[bool] = None
    format_conversion: Optional[bool] = None
    thousands_separator: Optional[bool] = None


DEFAULT_CLEANING_RULES = {
    "fullwidth_to_halfwidth": True,
    "trim_whitespace": True,
    "normalize_linebreaks": True,
    "null_standardization": True,
    "format_conversion": True,
    "thousands_separator": True,
}


# ── Endpoints ──

@router.get("/config")
def get_config(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get current AI configuration (any authenticated user can read)."""
    return get_ai_config(db)


@router.put("/config")
def put_config(
    body: AIConfigUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    """Update AI configuration (admin only). Local and cloud configs saved independently."""
    data = body.model_dump(exclude_none=True)
    # Convert bool → int for ai_enabled
    if "ai_enabled" in data:
        data["ai_enabled"] = 1 if data["ai_enabled"] else 0
    return update_ai_config(db, data, operator=current_user.username)


@router.post("/config/test")
async def test_connection(
    body: AITestRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    """Test LLM connection. Accepts explicit params or falls back to stored config."""
    api_url = body.api_url
    api_key = body.api_key
    model_name = body.model_name
    api_protocol = body.api_protocol or "openai"

    # If params not provided, try stored config based on test_mode
    if not api_key or not api_url:
        row = db.query(AIConfig).first()
        if row:
            mode = body.test_mode or row.engine_mode or "cloud"
            if mode == "local":
                if not api_url:
                    api_url = row.local_api_url
                if not api_key and row.local_api_key_encrypted:
                    try:
                        api_key = decrypt_password(row.local_api_key_encrypted)
                    except Exception:
                        pass
                if not model_name:
                    model_name = row.local_model_name
                if not body.api_protocol:
                    api_protocol = row.local_api_protocol or "openai"
            else:  # cloud
                if not api_url:
                    api_url = row.cloud_api_url
                if not api_key and row.cloud_api_key_encrypted:
                    try:
                        api_key = decrypt_password(row.cloud_api_key_encrypted)
                    except Exception:
                        pass
                if not model_name:
                    model_name = row.cloud_model_name
                if not body.api_protocol:
                    api_protocol = row.cloud_api_protocol or "openai"

    if not api_url or not model_name:
        raise HTTPException(status_code=400, detail=t("ai.config_provide_url_model"))

    client = AIClient(
        api_url=api_url,
        api_key=api_key or "",
        model_name=model_name,
        api_protocol=api_protocol,
        max_tokens=body.max_tokens or 4096,
        temperature=body.temperature or 0.3,
        timeout=15.0,
    )
    result = await client.test_connection()
    return result


# ── AI Validate Config Endpoints ──

@router.get("/validate-config")
def get_validate_config(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get AI validation configuration."""
    from app.routers.ai_validate import DEFAULT_VALIDATE_CONFIG
    config = DEFAULT_VALIDATE_CONFIG.copy()

    for key in ("outlier_range", "history_sample_size", "warning_behavior", "skip_fields"):
        full_key = f"ai_validate_{key}"
        row = db.query(SystemSetting).filter(SystemSetting.setting_key == full_key).first()
        if row:
            if key == "history_sample_size":
                try:
                    config[key] = int(row.setting_value)
                except ValueError:
                    pass
            elif key == "skip_fields":
                try:
                    config[key] = json.loads(row.setting_value)
                except (json.JSONDecodeError, TypeError):
                    config[key] = [s.strip() for s in row.setting_value.split(",") if s.strip()]
            else:
                config[key] = row.setting_value

    return config


@router.get("/cleaning-rules")
def get_cleaning_rules(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get current cleaning rules configuration."""
    rules = DEFAULT_CLEANING_RULES.copy()
    row = db.query(SystemSetting).filter(SystemSetting.setting_key == "cleaning_rules").first()
    if row:
        try:
            saved = json.loads(row.setting_value)
            rules.update(saved)
        except (json.JSONDecodeError, TypeError):
            pass
    return rules


@router.put("/cleaning-rules")
def put_cleaning_rules(
    body: CleaningRulesUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    """Update cleaning rules configuration (admin only)."""
    from app.models import _now_bjt

    # Load existing
    rules = DEFAULT_CLEANING_RULES.copy()
    row = db.query(SystemSetting).filter(SystemSetting.setting_key == "cleaning_rules").first()
    if row:
        try:
            saved = json.loads(row.setting_value)
            rules.update(saved)
        except (json.JSONDecodeError, TypeError):
            pass

    # Merge updates
    updates = body.model_dump(exclude_none=True)
    rules.update(updates)

    store_value = json.dumps(rules, ensure_ascii=False)
    if row:
        row.setting_value = store_value
        row.updated_at = _now_bjt()
    else:
        row = SystemSetting(setting_key="cleaning_rules", setting_value=store_value)
        db.add(row)

    db.commit()
    return rules


@router.put("/validate-config")
def put_validate_config(
    body: AIValidateConfigUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    """Update AI validation configuration (admin only)."""
    from app.models import _now_bjt

    updates = body.model_dump(exclude_none=True)
    for key, value in updates.items():
        full_key = f"ai_validate_{key}"
        row = db.query(SystemSetting).filter(SystemSetting.setting_key == full_key).first()

        if key == "skip_fields":
            store_value = json.dumps(value, ensure_ascii=False)
        elif key == "history_sample_size":
            store_value = str(value)
        else:
            store_value = str(value)

        if row:
            row.setting_value = store_value
            row.updated_at = _now_bjt()
        else:
            row = SystemSetting(setting_key=full_key, setting_value=store_value)
            db.add(row)

    db.commit()
    return get_validate_config(db=db, current_user=current_user)
