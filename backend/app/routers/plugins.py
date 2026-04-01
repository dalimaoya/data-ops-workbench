"""Plugin management API — list all plugins, toggle enable/disable for extensions."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session

from app.utils.auth import get_current_user, require_role
from app.database import get_db

from app.plugin_loader import get_all_plugins_full, toggle_plugin
from app.i18n import t

router = APIRouter(prefix="/api/plugins", tags=["plugins"])


class ToggleRequest(BaseModel):
    enabled: bool


class ToggleResponse(BaseModel):
    plugin_id: str
    enabled: bool
    message: str


@router.get("/all")
def list_all_plugins(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Return all plugins with layer/category/enabled status (for plugin center)."""
    from app.models import TrialActivation, _now_bjt

    plugins = get_all_plugins_full()

    # Check trial activation for extension authorization
    has_active_trial = False
    try:
        now = _now_bjt()
        trial = db.query(TrialActivation).filter(
            TrialActivation.expires_at > now.replace(tzinfo=None)
        ).first()
        has_active_trial = trial is not None
    except Exception:
        pass

    for p in plugins:
        if p.get("layer") == "builtin":
            p["authorized"] = True
        else:
            p["authorized"] = has_active_trial

    return {"plugins": plugins}


@router.put("/{plugin_id}/toggle")
def toggle_plugin_status(
    plugin_id: str,
    body: ToggleRequest,
    current_user=Depends(require_role("admin")),
):
    """Enable or disable an extension plugin (admin only)."""
    try:
        new_state = toggle_plugin(
            plugin_id,
            body.enabled,
            operator=current_user.username,
        )
        action = t("user.enable") if new_state else t("user.disable")
        return ToggleResponse(
            plugin_id=plugin_id,
            enabled=new_state,
            message=t("plugin.toggled", action=action),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/trial-status")
def get_trial_status(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return current trial activation status."""
    from app.models import TrialActivation, _now_bjt, _BJT
    from math import ceil

    now = _now_bjt()
    now_naive = now.replace(tzinfo=None)
    trial = db.query(TrialActivation).filter(
        TrialActivation.expires_at > now_naive
    ).order_by(TrialActivation.expires_at.desc()).first()

    if trial:
        expires = trial.expires_at
        # SQLite returns naive datetimes; make aware for subtraction
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=_BJT)
        remaining = (expires - now).total_seconds()
        days_remaining = max(0, ceil(remaining / 86400))
        return {
            "active": True,
            "expires_at": trial.expires_at.isoformat(),
            "days_remaining": days_remaining,
        }

    return {
        "active": False,
        "expires_at": None,
        "days_remaining": 0,
    }
