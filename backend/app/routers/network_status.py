"""Network status API — check if server can reach the internet."""

import time
import socket
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter
from app.i18n import t

logger = logging.getLogger("network_status")

router = APIRouter(prefix="/api/system", tags=["System"])

# ── Cached result ──
_cache: dict = {
    "online": None,
    "checked_at": None,
    "cached_until": 0.0,
}
_CACHE_TTL = 60  # seconds


def _check_internet(timeout: float = 3.0) -> bool:
    """Try to connect to well-known DNS / HTTP endpoints.
    Returns True if any connection succeeds."""
    targets = [
        ("8.8.8.8", 53),         # Google DNS
        ("1.1.1.1", 53),         # Cloudflare DNS
        ("223.5.5.5", 53),       # AliDNS
        ("114.114.114.114", 53), # 114 DNS
    ]
    for host, port in targets:
        try:
            sock = socket.create_connection((host, port), timeout=timeout)
            sock.close()
            return True
        except (OSError, socket.timeout):
            continue
    return False


@router.get("/network-status")
def get_network_status():
    """Return whether the server can reach the internet.
    Result is cached for 60 seconds."""
    now = time.time()
    if _cache["online"] is not None and now < _cache["cached_until"]:
        return {
            "online": _cache["online"],
            "checked_at": _cache["checked_at"],
        }

    online = _check_internet()
    checked_at = datetime.now(timezone.utc).isoformat()

    _cache["online"] = online
    _cache["checked_at"] = checked_at
    _cache["cached_until"] = now + _CACHE_TTL

    logger.info("Network check: online=%s", online)

    return {
        "online": online,
        "checked_at": checked_at,
    }
