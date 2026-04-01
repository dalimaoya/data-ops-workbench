"""AI configuration read/write — dual independent storage for local + cloud configs."""

import json
from typing import Optional
from sqlalchemy.orm import Session

from app.models import AIConfig
from app.utils.crypto import encrypt_password, decrypt_password


# Default feature flags (all enabled)
DEFAULT_FEATURE_FLAGS = {
    "field_suggest": True,
    "data_validate": True,
    "nl_query": True,
    "log_analyze": True,
    "batch_fill": True,
    "health_check": True,
    "impact_assess": True,
}


def _mask_key(encrypted: Optional[str]) -> tuple[bool, str]:
    """Return (is_set, masked_display) for an encrypted API key."""
    if not encrypted:
        return False, ""
    try:
        plain = decrypt_password(encrypted)
        if len(plain) > 8:
            return True, plain[:3] + "●" * (len(plain) - 6) + plain[-3:]
        return True, "●" * len(plain)
    except Exception:
        return True, "●●●●●●"


def get_ai_config(db: Session) -> dict:
    """Return the AI config with both local and cloud configs included."""
    row = db.query(AIConfig).first()
    if row is None:
        row = AIConfig(
            ai_enabled=1,
            engine_mode="builtin",
            feature_flags=json.dumps(DEFAULT_FEATURE_FLAGS),
        )
        db.add(row)
        db.commit()
        db.refresh(row)

    return _row_to_dict(row)


def update_ai_config(db: Session, data: dict, operator: str = "system") -> dict:
    """Upsert the AI config. Saves local_* and cloud_* fields independently."""
    row = db.query(AIConfig).first()
    if row is None:
        row = AIConfig()
        db.add(row)

    # Global fields
    for field in ("ai_enabled", "engine_mode"):
        if field in data:
            setattr(row, field, data[field])

    # Local model fields
    for field in ("local_api_protocol", "local_api_url", "local_model_name",
                  "local_max_tokens", "local_temperature"):
        if field in data:
            setattr(row, field, data[field])

    if "local_api_key" in data and data["local_api_key"]:
        row.local_api_key_encrypted = encrypt_password(data["local_api_key"])

    # Cloud LLM fields
    for field in ("cloud_platform_name", "cloud_api_protocol", "cloud_api_url",
                  "cloud_model_name", "cloud_max_tokens", "cloud_temperature"):
        if field in data:
            setattr(row, field, data[field])

    if "cloud_api_key" in data and data["cloud_api_key"]:
        row.cloud_api_key_encrypted = encrypt_password(data["cloud_api_key"])

    # Feature flags
    if "feature_flags" in data:
        flags = data["feature_flags"]
        if isinstance(flags, dict):
            row.feature_flags = json.dumps(flags)

    row.updated_by = operator
    db.commit()
    db.refresh(row)
    return _row_to_dict(row)


def _row_to_dict(row: AIConfig) -> dict:
    """Convert AIConfig ORM row to API-safe dict with dual config."""
    local_key_set, local_key_masked = _mask_key(row.local_api_key_encrypted)
    cloud_key_set, cloud_key_masked = _mask_key(row.cloud_api_key_encrypted)

    feature_flags = DEFAULT_FEATURE_FLAGS.copy()
    if row.feature_flags:
        try:
            feature_flags.update(json.loads(row.feature_flags))
        except Exception:
            pass

    return {
        "ai_enabled": bool(row.ai_enabled),
        "engine_mode": row.engine_mode or "builtin",

        # Local model config
        "local_api_protocol": row.local_api_protocol or "openai",
        "local_api_url": row.local_api_url or "",
        "local_api_key_set": local_key_set,
        "local_api_key_masked": local_key_masked,
        "local_model_name": row.local_model_name or "",
        "local_max_tokens": row.local_max_tokens or 4096,
        "local_temperature": row.local_temperature if row.local_temperature is not None else 0.3,

        # Cloud LLM config
        "cloud_platform_name": row.cloud_platform_name or "",
        "cloud_api_protocol": row.cloud_api_protocol or "openai",
        "cloud_api_url": row.cloud_api_url or "",
        "cloud_api_key_set": cloud_key_set,
        "cloud_api_key_masked": cloud_key_masked,
        "cloud_model_name": row.cloud_model_name or "",
        "cloud_max_tokens": row.cloud_max_tokens or 4096,
        "cloud_temperature": row.cloud_temperature if row.cloud_temperature is not None else 0.3,

        "feature_flags": feature_flags,
    }
