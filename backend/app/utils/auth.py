"""JWT authentication, bcrypt password hashing, and role-based access control."""

import os
import sys
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.database import get_db, DATA_DIR
from app.models import UserAccount, _now_bjt
from app.i18n import t

# ─────────────────────────────────────────────
# JWT Secret Key Management
# ─────────────────────────────────────────────

_DEFAULT_SECRET = "data-ops-workbench-secret-key-2026"
_JWT_KEY_FILE = os.path.join(DATA_DIR, "jwt_secret.key")


def _load_jwt_secret() -> str:
    """Load JWT secret with priority: env var > file > auto-generate > default."""
    # 1. Environment variable takes highest priority
    env_secret = os.environ.get("JWT_SECRET")
    if env_secret and env_secret != _DEFAULT_SECRET:
        return env_secret
    
    # 2. Try to load from file
    if os.path.exists(_JWT_KEY_FILE):
        try:
            with open(_JWT_KEY_FILE, "r") as f:
                key = f.read().strip()
            if key and key != _DEFAULT_SECRET:
                return key
        except Exception:
            pass
    
    # 3. Auto-generate and save
    try:
        key = secrets.token_urlsafe(64)
        os.makedirs(os.path.dirname(_JWT_KEY_FILE), exist_ok=True)
        with open(_JWT_KEY_FILE, "w") as f:
            f.write(key)
        os.chmod(_JWT_KEY_FILE, 0o600)
        print(f"[安全] JWT 密钥已自动生成并保存到 {_JWT_KEY_FILE}")
        return key
    except Exception as e:
        # Fallback to default with warning
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"⚠️  警告: 正在使用默认 JWT 密钥！这在生产环境中不安全！", file=sys.stderr)
        print(f"    请设置环境变量 JWT_SECRET 或确保 {_JWT_KEY_FILE} 可写", file=sys.stderr)
        print(f"    错误: {e}", file=sys.stderr)
        print(f"{'='*60}\n", file=sys.stderr)
        return _DEFAULT_SECRET


SECRET_KEY = _load_jwt_secret()
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

security = HTTPBearer(auto_error=False)

# ─────────────────────────────────────────────
# Password Hashing with bcrypt
# ─────────────────────────────────────────────

# bcrypt context for new passwords
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Legacy salt for SHA256 migration
_LEGACY_SALT = "data-ops-workbench-salt"


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return _pwd_context.hash(password)


def _legacy_hash(password: str) -> str:
    """Compute legacy SHA256 hash for migration check."""
    return hashlib.sha256(f"{_LEGACY_SALT}{password}".encode()).hexdigest()


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a password against a hash.
    
    Supports both bcrypt and legacy SHA256 hashes.
    For legacy hashes, returns True but the caller should trigger migration.
    """
    # Try bcrypt first (bcrypt hashes start with $2b$ or $2a$)
    if hashed.startswith(("$2b$", "$2a$", "$2y$")):
        return _pwd_context.verify(plain, hashed)
    
    # Legacy SHA256 check
    return _legacy_hash(plain) == hashed


def needs_password_migration(hashed: str) -> bool:
    """Check if a password hash needs to be migrated to bcrypt."""
    return not hashed.startswith(("$2b$", "$2a$", "$2y$"))


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = _now_bjt() + (expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail=t("auth.token_invalid_expired"))


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> UserAccount:
    """Extract current user from JWT token."""
    if not credentials:
        raise HTTPException(status_code=401, detail=t("auth.no_credentials"))
    payload = decode_token(credentials.credentials)
    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail=t("auth.token_invalid"))
    user = db.query(UserAccount).filter(
        UserAccount.username == username,
        UserAccount.status == "enabled",
    ).first()
    if not user:
        raise HTTPException(status_code=401, detail=t("auth.user_not_found_disabled"))
    return user


def require_role(*roles: str):
    """Dependency: require user has one of the given roles."""
    def checker(user: UserAccount = Depends(get_current_user)):
        if user.role not in roles:
            raise HTTPException(status_code=403, detail=t("auth.insufficient_role", roles=', '.join(roles)))
        return user
    return checker


def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> Optional[UserAccount]:
    """Get user if token present, else None (for backward compat)."""
    if not credentials:
        return None
    try:
        return get_current_user(credentials, db)
    except HTTPException:
        return None


def init_default_admin(db: Session):
    """Create default admin user if not exists."""
    existing = db.query(UserAccount).filter(UserAccount.username == "admin").first()
    if not existing:
        admin = UserAccount(
            username="admin",
            password_hash=hash_password("dalimaoya"),
            role="admin",
            display_name="管理员",
            status="enabled",
        )
        db.add(admin)
        db.commit()
