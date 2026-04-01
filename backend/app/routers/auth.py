"""Authentication endpoints: login, me, captcha, lockout management."""

from fastapi import APIRouter, Depends, HTTPException, Request
from typing import Optional
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import UserAccount
from app.utils.auth import (
    verify_password, create_access_token, get_current_user,
    hash_password, needs_password_migration, require_role,
)
from app.utils.captcha import generate_captcha, verify_captcha
from app.utils.security_middleware import (
    login_lockout, check_rate_limit,
)
from app.i18n import t

router = APIRouter(prefix="/api/auth", tags=["认证"])


class LoginRequest(BaseModel):
    username: str
    password: str
    captcha_id: Optional[str] = None
    captcha_code: Optional[str] = None


class LoginResponse(BaseModel):
    token: str
    username: str
    role: str
    display_name: Optional[str]


class UserInfo(BaseModel):
    id: int
    username: str
    role: str
    display_name: Optional[str]
    status: str


class CaptchaResponse(BaseModel):
    captcha_id: str
    image: str  # base64 png


@router.get("/check-update")
async def check_update():
    """Check for new version from Gitee releases. Manual trigger only."""
    import httpx
    import os

    current_version = "0.0.0"
    # Try DATA_OPS_BASE_DIR first (set by app_entry.py in packaged mode), then fallback to source layout
    base_dir = os.environ.get('DATA_OPS_BASE_DIR')
    if not base_dir:
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    for candidate in [
        os.path.join(base_dir, "version.txt"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "version.txt"),
    ]:
        if os.path.exists(candidate):
            with open(candidate) as f:
                v = f.read().strip()
                if v:
                    current_version = v
                    break

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://gitee.com/api/v5/repos/dalimaoya/data-ops-workbench/releases/latest"
            )
            if resp.status_code == 200:
                data = resp.json()
                latest_version = (data.get("tag_name") or "").lstrip("v")
                return {
                    "current_version": current_version,
                    "latest_version": latest_version,
                    "has_update": latest_version > current_version if latest_version else False,
                    "release_name": data.get("name"),
                    "release_url": data.get("html_url"),
                    "release_body": data.get("body", "")[:500],
                    "published_at": data.get("created_at"),
                }
            return {
                "current_version": current_version,
                "latest_version": None,
                "has_update": False,
                "error": "无法获取版本信息",
            }
    except Exception as e:
        return {
            "current_version": current_version,
            "latest_version": None,
            "has_update": False,
            "error": f"网络不可用：{str(e)[:100]}",
        }


@router.get("/captcha", response_model=CaptchaResponse)
def get_captcha(request: Request):
    """Generate a captcha image for login."""
    # Rate limit captcha generation
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit("captcha", client_ip):
        raise HTTPException(status_code=429, detail=t("auth.rate_limited"))
    
    captcha_id, _code, b64_image = generate_captcha()
    return CaptchaResponse(captcha_id=captcha_id, image=b64_image)


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    # Rate limit login attempts by IP
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit("login", client_ip):
        raise HTTPException(status_code=429, detail=t("auth.rate_limited"))
    
    # Verify captcha first
    if not req.captcha_id or not req.captcha_code:
        raise HTTPException(status_code=400, detail=t("auth.captcha_required"))
    if not verify_captcha(req.captcha_id, req.captcha_code):
        raise HTTPException(status_code=400, detail=t("auth.captcha_invalid"))
    
    # Check if account is locked
    if login_lockout.is_locked(req.username):
        lock_info = login_lockout.get_lock_info(req.username)
        raise HTTPException(
            status_code=403,
            detail=t("auth.account_locked", minutes=lock_info.get("remaining_seconds", 900) // 60 + 1),
        )

    user = db.query(UserAccount).filter(
        UserAccount.username == req.username,
        UserAccount.status == "enabled",
    ).first()
    
    if not user or not verify_password(req.password, user.password_hash):
        # Record failure
        remaining = login_lockout.record_failure(req.username)
        if remaining == 0:
            raise HTTPException(
                status_code=403,
                detail=t("auth.account_locked", minutes=15),
            )
        raise HTTPException(
            status_code=401,
            detail=t("auth.credentials_invalid"),
        )
    
    # Successful login - reset lockout counter
    login_lockout.reset(req.username)
    
    # Auto-migrate legacy password hash to bcrypt
    if needs_password_migration(user.password_hash):
        user.password_hash = hash_password(req.password)
    
    # v3.6: Record last login time
    from app.models import _now_bjt
    user.last_login_at = _now_bjt()
    db.commit()
    
    token = create_access_token({"sub": user.username, "role": user.role})
    return LoginResponse(
        token=token,
        username=user.username,
        role=user.role,
        display_name=user.display_name,
    )


@router.get("/me", response_model=UserInfo)
def get_me(user: UserAccount = Depends(get_current_user)):
    return UserInfo(
        id=user.id,
        username=user.username,
        role=user.role,
        display_name=user.display_name,
        status=user.status,
    )


# ─────────────────────────────────────────────
# Login Lockout Management (admin only)
# ─────────────────────────────────────────────

@router.get("/lockout/{username}")
def get_lockout_status(
    username: str,
    user: UserAccount = Depends(require_role("admin")),
):
    """Get lock status for a user account."""
    info = login_lockout.get_lock_info(username)
    return info


@router.post("/lockout/{username}/unlock")
def unlock_account(
    username: str,
    user: UserAccount = Depends(require_role("admin")),
):
    """Manually unlock a locked account."""
    login_lockout.unlock(username)
    return {"detail": f"账号 {username} 已解锁"}
