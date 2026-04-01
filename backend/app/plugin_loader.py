"""Plugin loader — scan plugins/ directory, register plugins, manage layer/enabled state."""

import os
import sys
import json
import importlib
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional

from fastapi import FastAPI, Depends

logger = logging.getLogger("plugin_loader")


def _resolve_plugins_dir() -> str:
    """Resolve plugins directory, handling both dev and PyInstaller frozen mode."""
    # In frozen mode, __file__ may not point to the real source tree.
    # PyInstaller --onedir puts bundled data under _internal/ (PyInstaller 6+) or the dist dir.
    if getattr(sys, 'frozen', False):
        # _MEIPASS is the temp/extract dir for --onefile, or _internal dir for --onedir
        base = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
        candidate = os.path.join(base, "app", "plugins")
        if os.path.isdir(candidate):
            logger.info("Frozen mode: plugins dir = %s", candidate)
            return candidate
        # Fallback: try _internal/app/plugins (PyInstaller 6 --onedir)
        candidate2 = os.path.join(os.path.dirname(sys.executable), "_internal", "app", "plugins")
        if os.path.isdir(candidate2):
            logger.info("Frozen mode: plugins dir = %s", candidate2)
            return candidate2
    # Dev mode: relative to this file
    default = os.path.join(os.path.dirname(__file__), "plugins")
    logger.info("Plugins dir = %s (exists=%s)", default, os.path.isdir(default))
    return default


PLUGINS_DIR = _resolve_plugins_dir()

# Global registry: list of loaded plugin manifests
_loaded_plugins: List[Dict[str, Any]] = []

# All scanned manifests (loaded or not)
_all_manifests: List[Dict[str, Any]] = []

# All known plugin names (for "upgrade to unlock" display)
ALL_KNOWN_PLUGINS = [
    "plugin-notification",
    "plugin-approval",
    "plugin-backup",
    "plugin-report",
    "plugin-scheduler",
    "plugin-health-check",
    "plugin-batch-ops",
    "plugin-smart-import",
    "plugin-ai-assistant",
    "plugin-db-manager",
    "plugin-data-mask",
    "plugin-notification-push",
    "plugin-data-trend",
    "plugin-audit-export",
    "plugin-data-compare",
    "plugin-template-market",
    "plugin-ai-predict",
    "plugin-sql-console",
]

_BJT = timezone(timedelta(hours=8))


def _scan_manifests() -> List[Dict[str, Any]]:
    """Scan all manifest.json files and return manifest dicts."""
    manifests = []
    if not os.path.isdir(PLUGINS_DIR):
        return manifests
    for plugin_name in sorted(os.listdir(PLUGINS_DIR)):
        plugin_path = os.path.join(PLUGINS_DIR, plugin_name)
        manifest_path = os.path.join(plugin_path, "manifest.json")
        if not os.path.isfile(manifest_path):
            continue
        try:
            with open(manifest_path, encoding="utf-8") as f:
                manifest = json.load(f)
            manifest["_dir_name"] = plugin_name
            manifests.append(manifest)
        except Exception as e:
            logger.warning("Plugin %s: failed to parse manifest.json: %s", plugin_name, e)
    return manifests


def _get_enabled_extension_ids() -> set:
    """Query plugin_status table for enabled extension plugin IDs."""
    try:
        from app.database import SessionLocal
        from app.models import PluginStatus as PSModel
        db = SessionLocal()
        try:
            rows = db.query(PSModel).filter(PSModel.enabled == True).all()
            return {r.plugin_id for r in rows}
        finally:
            db.close()
    except Exception as e:
        logger.warning("Could not query plugin_status: %s", e)
        return set()


def load_plugins(app: FastAPI) -> List[str]:
    """Scan plugins/ directory, load plugins based on layer/enabled state."""
    global _loaded_plugins, _all_manifests
    _loaded_plugins = []
    _all_manifests = []
    loaded_names: List[str] = []

    _all_manifests = _scan_manifests()

    from app.utils.plugin_guard import require_plugin_enabled

    # Save original include_router so we can wrap it for extension plugins
    _original_include_router = app.include_router

    for manifest in _all_manifests:
        plugin_name = manifest.get("_dir_name", "")
        layer = manifest.get("layer", "builtin")
        plugin_id = manifest.get("name", plugin_name)

        # Skip deprecated plugins (merged into another plugin)
        if manifest.get("deprecated"):
            logger.info("[PLUGIN] %s is deprecated (replaced by %s), skipping",
                        plugin_id, manifest.get("deprecated_by", "?"))
            continue

        # For extension plugins, intercept include_router to inject the guard dependency
        if layer == "extension":
            guard_dep = Depends(require_plugin_enabled(plugin_id))

            def _guarded_include_router(router, *args, _guard=guard_dep, **kwargs):
                # Prepend our guard dependency to the router's dependencies
                existing = list(router.dependencies) if router.dependencies else []
                router.dependencies = [_guard] + existing
                _original_include_router(router, *args, **kwargs)

            app.include_router = _guarded_include_router
        else:
            app.include_router = _original_include_router

        try:
            module_name = plugin_name.replace("-", "_")
            module = importlib.import_module(f"app.plugins.{module_name}")

            if hasattr(module, "register"):
                module.register(app, manifest)
                loaded_names.append(plugin_id)
                _loaded_plugins.append(manifest)
                logger.info("[PLUGIN] %s v%s loaded (layer=%s)",
                            manifest.get("display_name", plugin_name),
                            manifest.get("version", "?"),
                            layer)
            else:
                logger.warning("Plugin %s has no register() function", plugin_name)
        except Exception as e:
            logger.warning("Plugin %s failed to load: %s", plugin_name, e, exc_info=True)

    # Restore original include_router
    app.include_router = _original_include_router

    return loaded_names


def get_loaded_plugins() -> List[Dict[str, Any]]:
    """Return list of loaded plugin manifests."""
    return list(_loaded_plugins)


def get_all_plugin_status() -> List[Dict[str, Any]]:
    """Return all known plugins with loaded/enabled status (for menu rendering).
    Builtin plugins are always 'loaded'. Extension plugins show as loaded only if enabled."""
    from app.utils.plugin_guard import is_plugin_enabled

    loaded_names = {p.get("name") for p in _loaded_plugins}
    result = []

    for manifest in _loaded_plugins:
        name = manifest.get("name")
        layer = manifest.get("layer", "builtin")
        # For extension plugins, check enabled state dynamically
        if layer == "extension":
            is_active = is_plugin_enabled(name)
        else:
            is_active = True

        result.append({
            "name": name,
            "display_name": manifest.get("display_name"),
            "display_name_en": manifest.get("display_name_en"),
            "version": manifest.get("version"),
            "description": manifest.get("description"),
            "loaded": is_active,
            "layer": layer,
            "category": manifest.get("category", "tool"),
            "frontend": manifest.get("frontend", {}),
        })

    # Add unloaded known plugins (not loaded but known)
    for name in ALL_KNOWN_PLUGINS:
        if name not in loaded_names:
            result.append({
                "name": name,
                "display_name": name,
                "display_name_en": name,
                "version": None,
                "description": None,
                "loaded": False,
                "layer": "unknown",
                "category": "unknown",
                "frontend": {},
            })

    return result


def get_all_plugins_full() -> List[Dict[str, Any]]:
    """Return ALL plugins (all manifests) with layer/category/enabled status.
    Used by plugin center page."""
    loaded_names = {p.get("name") for p in _loaded_plugins}
    enabled_ids = _get_enabled_extension_ids()
    result = []

    for manifest in _all_manifests:
        name = manifest.get("name")
        layer = manifest.get("layer", "builtin")
        is_loaded = name in loaded_names

        # Skip deprecated plugins
        if manifest.get("deprecated"):
            continue

        if layer == "builtin":
            enabled = True
        else:
            enabled = name in enabled_ids

        result.append({
            "name": name,
            "display_name": manifest.get("display_name"),
            "display_name_en": manifest.get("display_name_en"),
            "version": manifest.get("version"),
            "description": manifest.get("description"),
            "author": manifest.get("author"),
            "license": manifest.get("license", "free"),
            "layer": layer,
            "category": manifest.get("category", "tool"),
            "enabled": enabled,
            "loaded": is_loaded,
            "frontend": manifest.get("frontend", {}),
        })

    return result


def toggle_plugin(plugin_id: str, enable: bool, operator: str = "admin") -> bool:
    """Toggle an extension plugin's enabled state. Returns new enabled state."""
    from app.database import SessionLocal
    from app.models import PluginStatus as PSModel
    from app.utils.plugin_guard import clear_cache

    # Verify plugin exists and is extension
    manifest = None
    for m in _all_manifests:
        if m.get("name") == plugin_id:
            manifest = m
            break

    if not manifest:
        raise ValueError(f"Plugin '{plugin_id}' not found")

    if manifest.get("layer") != "extension":
        raise ValueError(f"Plugin '{plugin_id}' is builtin, cannot toggle")

    db = SessionLocal()
    try:
        row = db.query(PSModel).filter(PSModel.plugin_id == plugin_id).first()
        now = datetime.now(_BJT)

        if row:
            row.enabled = enable
            row.enabled_by = operator if enable else None
            row.enabled_at = now if enable else None
            row.updated_at = now
        else:
            row = PSModel(
                plugin_id=plugin_id,
                enabled=enable,
                enabled_by=operator if enable else None,
                enabled_at=now if enable else None,
            )
            db.add(row)

        db.commit()
        # Clear plugin guard cache so subsequent requests see the new state immediately
        clear_cache(plugin_id)
        return enable
    finally:
        db.close()
