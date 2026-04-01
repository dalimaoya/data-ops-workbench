"""Plugin guard — runtime check whether an extension plugin is enabled.

Provides a FastAPI dependency factory that returns 403 when the
requested plugin is disabled in plugin_status, with in-memory caching
that is invalidated on toggle.
"""

import logging
from typing import Optional

from fastapi import HTTPException

logger = logging.getLogger("plugin_guard")

# In-memory cache: plugin_id -> enabled (bool)
_cache: dict[str, bool] = {}


def _query_enabled(plugin_id: str) -> bool:
    """Query DB for plugin enabled state."""
    try:
        from app.database import SessionLocal
        from app.models import PluginStatus as PSModel

        db = SessionLocal()
        try:
            row = db.query(PSModel).filter(PSModel.plugin_id == plugin_id).first()
            return bool(row and row.enabled)
        finally:
            db.close()
    except Exception as e:
        logger.warning("plugin_guard: could not query plugin_status for %s: %s", plugin_id, e)
        return False


def is_plugin_enabled(plugin_id: str) -> bool:
    """Check if a plugin is enabled, using cache."""
    if plugin_id in _cache:
        return _cache[plugin_id]
    enabled = _query_enabled(plugin_id)
    _cache[plugin_id] = enabled
    return enabled


def clear_cache(plugin_id: Optional[str] = None):
    """Clear cached enabled state. Call after toggle_plugin."""
    if plugin_id:
        _cache.pop(plugin_id, None)
        logger.info("plugin_guard: cleared cache for %s", plugin_id)
    else:
        _cache.clear()
        logger.info("plugin_guard: cleared all cache")


def require_plugin_enabled(plugin_id: str):
    """Return a FastAPI dependency that blocks requests when plugin is disabled."""

    def _guard():
        if not is_plugin_enabled(plugin_id):
            raise HTTPException(
                status_code=403,
                detail=f"插件未启用，请在插件中心开启",
            )

    return _guard
