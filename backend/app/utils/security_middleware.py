"""Security middleware: security headers, rate limiting, login lockout, XSS sanitization."""

import os
import time
import html
import re
from collections import defaultdict
from threading import Lock
from typing import Optional, Dict, Any, List, Union
from datetime import datetime, timedelta

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware


# ─────────────────────────────────────────────
# Security Response Headers Middleware
# ─────────────────────────────────────────────

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""
    
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://res.wx.qq.com; "
            "style-src 'self' 'unsafe-inline' https://res.wx.qq.com; "
            "img-src 'self' data: blob: https://*.qq.com https://*.weixin.qq.com; "
            "font-src 'self' data:; "
            "connect-src 'self' https://auth.aiusing.net https://*.qq.com; "
            "frame-src https://open.weixin.qq.com"
        )
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        return response


# ─────────────────────────────────────────────
# In-Memory Rate Limiter
# ─────────────────────────────────────────────

class RateLimitEntry:
    """Track request counts within a time window."""
    __slots__ = ('timestamps',)
    
    def __init__(self):
        self.timestamps: List[float] = []
    
    def add_and_check(self, now: float, window_seconds: int, max_requests: int) -> bool:
        """Add a request timestamp and check if rate limit is exceeded.
        Returns True if the request is allowed, False if rate limited.
        """
        # Clean old entries
        cutoff = now - window_seconds
        self.timestamps = [t for t in self.timestamps if t > cutoff]
        
        if len(self.timestamps) >= max_requests:
            return False
        
        self.timestamps.append(now)
        return True


class RateLimiter:
    """In-memory rate limiter with configurable rules per endpoint pattern."""
    
    def __init__(self):
        self._entries: Dict[str, RateLimitEntry] = {}
        self._lock = Lock()
        self._last_cleanup = time.time()
        self._cleanup_interval = 300  # clean up every 5 minutes
    
    def is_allowed(self, key: str, window_seconds: int = 60, max_requests: int = 60) -> bool:
        """Check if a request is allowed under the rate limit.
        
        Args:
            key: Unique key (e.g., "login:192.168.1.1" or "export:user123")
            window_seconds: Time window in seconds
            max_requests: Maximum requests within the window
        """
        now = time.time()
        
        with self._lock:
            # Periodic cleanup of stale entries
            if now - self._last_cleanup > self._cleanup_interval:
                self._cleanup(now)
                self._last_cleanup = now
            
            if key not in self._entries:
                self._entries[key] = RateLimitEntry()
            
            return self._entries[key].add_and_check(now, window_seconds, max_requests)
    
    def _cleanup(self, now: float):
        """Remove entries with no recent activity."""
        stale_keys = []
        for key, entry in self._entries.items():
            if not entry.timestamps or (now - entry.timestamps[-1]) > 300:
                stale_keys.append(key)
        for key in stale_keys:
            del self._entries[key]


# Global rate limiter instance
rate_limiter = RateLimiter()

# Rate limit configuration
RATE_LIMITS = {
    "login": {"window": 60, "max": 5},       # 5 per minute per IP
    "captcha": {"window": 60, "max": 10},     # 10 per minute per IP
    "export": {"window": 60, "max": 10},      # 10 per minute per user
    "writeback": {"window": 60, "max": 5},    # 5 per minute per user
    "general": {"window": 60, "max": 200},     # 200 per minute per user
}


def check_rate_limit(category: str, identifier: str) -> bool:
    """Check if a request is within rate limits.
    
    Args:
        category: Rate limit category (login, export, writeback, general)
        identifier: IP address or username
    
    Returns:
        True if allowed, False if rate limited
    """
    # Skip rate limiting for localhost/testing
    if identifier in ("127.0.0.1", "localhost", "::1", "testclient"):
        return True
    
    config = RATE_LIMITS.get(category, RATE_LIMITS["general"])
    key = f"{category}:{identifier}"
    return rate_limiter.is_allowed(key, config["window"], config["max"])


# ─────────────────────────────────────────────
# Login Failure Lockout
# ─────────────────────────────────────────────

class LoginLockout:
    """Track login failures and lock accounts after too many attempts."""
    
    def __init__(self, max_attempts: int = 5, lockout_minutes: int = 15):
        self.max_attempts = max_attempts
        self.lockout_minutes = lockout_minutes
        self._failures: Dict[str, List[float]] = {}
        self._locked_until: Dict[str, float] = {}
        self._lock = Lock()
    
    def is_locked(self, username: str) -> bool:
        """Check if an account is currently locked."""
        with self._lock:
            if username in self._locked_until:
                if time.time() < self._locked_until[username]:
                    return True
                else:
                    # Lock expired, clean up
                    del self._locked_until[username]
                    if username in self._failures:
                        del self._failures[username]
            return False
    
    def record_failure(self, username: str) -> int:
        """Record a login failure. Returns remaining attempts before lockout.
        Returns 0 if the account is now locked.
        """
        now = time.time()
        with self._lock:
            if username not in self._failures:
                self._failures[username] = []
            
            # Clean old failures
            cutoff = now - (self.lockout_minutes * 60)
            self._failures[username] = [t for t in self._failures[username] if t > cutoff]
            self._failures[username].append(now)
            
            if len(self._failures[username]) >= self.max_attempts:
                self._locked_until[username] = now + (self.lockout_minutes * 60)
                return 0
            
            return self.max_attempts - len(self._failures[username])
    
    def reset(self, username: str):
        """Reset failure count (on successful login)."""
        with self._lock:
            self._failures.pop(username, None)
            self._locked_until.pop(username, None)
    
    def unlock(self, username: str):
        """Admin manual unlock."""
        with self._lock:
            self._failures.pop(username, None)
            self._locked_until.pop(username, None)
    
    def get_lock_info(self, username: str) -> Optional[Dict]:
        """Get lock status info for a user."""
        with self._lock:
            if username in self._locked_until:
                locked_until = self._locked_until[username]
                if time.time() < locked_until:
                    return {
                        "locked": True,
                        "locked_until": datetime.fromtimestamp(locked_until).isoformat(),
                        "remaining_seconds": int(locked_until - time.time()),
                    }
            
            failures = self._failures.get(username, [])
            return {
                "locked": False,
                "recent_failures": len(failures),
                "max_attempts": self.max_attempts,
            }


# Global login lockout instance
login_lockout = LoginLockout(max_attempts=5, lockout_minutes=15)


# ─────────────────────────────────────────────
# XSS Sanitization
# ─────────────────────────────────────────────

def sanitize_html(value: str) -> str:
    """Escape HTML tags in a string to prevent XSS."""
    if not value or not isinstance(value, str):
        return value
    return html.escape(value, quote=True)


def sanitize_dict(data: Any) -> Any:
    """Recursively sanitize all string values in a dict/list structure."""
    if isinstance(data, str):
        return sanitize_html(data)
    elif isinstance(data, dict):
        return {k: sanitize_dict(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [sanitize_dict(item) for item in data]
    return data


# ─────────────────────────────────────────────
# File Upload Security
# ─────────────────────────────────────────────

ALLOWED_UPLOAD_EXTENSIONS = {'.xlsx', '.xls'}
MAX_UPLOAD_SIZE_MB = 50
MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024


def validate_upload_file(filename: str, content_length: Optional[int] = None, content: Optional[bytes] = None) -> Optional[str]:
    """Validate an uploaded file. Returns error message or None if valid."""
    if not filename:
        return "文件名不能为空"
    
    # Check for path traversal
    if '..' in filename or '/' in filename or '\\' in filename:
        return "文件名包含非法字符"
    
    # Check extension
    ext = os.path.splitext(filename.lower())[1]
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        return f"不支持的文件类型: {ext}，仅允许 {', '.join(ALLOWED_UPLOAD_EXTENSIONS)}"
    
    # Check size
    size = content_length or (len(content) if content else 0)
    if size > MAX_UPLOAD_SIZE_BYTES:
        return f"文件大小超过限制: {size / 1024 / 1024:.1f}MB > {MAX_UPLOAD_SIZE_MB}MB"
    
    return None
