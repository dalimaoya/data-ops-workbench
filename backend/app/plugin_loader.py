"""Plugin loader — scan plugins/ directory and register each plugin with FastAPI."""

import os
import json
import importlib
import logging
from typing import List, Dict, Any

from fastapi import FastAPI

logger = logging.getLogger("plugin_loader")

PLUGINS_DIR = os.path.join(os.path.dirname(__file__), "plugins")

# Global registry: list of loaded plugin manifests
_loaded_plugins: List[Dict[str, Any]] = []

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
    "plugin-notify-push",
    "plugin-data-trend",
    "plugin-audit-export",
    "plugin-data-compare",
    "plugin-template-market",
    "plugin-ai-predict",
    "plugin-webhook",
    "plugin-sql-console",
]


def load_plugins(app: FastAPI) -> List[str]:
    """Scan plugins/ directory, load all valid plugins, return loaded names."""
    global _loaded_plugins
    _loaded_plugins = []
    loaded_names: List[str] = []

    if not os.path.isdir(PLUGINS_DIR):
        logger.info("No plugins/ directory found — running in core-only mode")
        return loaded_names

    for plugin_name in sorted(os.listdir(PLUGINS_DIR)):
        plugin_path = os.path.join(PLUGINS_DIR, plugin_name)
        manifest_path = os.path.join(plugin_path, "manifest.json")

        if not os.path.isfile(manifest_path):
            continue

        try:
            with open(manifest_path, encoding="utf-8") as f:
                manifest = json.load(f)
        except Exception as e:
            logger.warning("Plugin %s: failed to parse manifest.json: %s", plugin_name, e)
            continue

        try:
            # Use underscored module name for import (Python doesn't like hyphens)
            module_name = plugin_name.replace("-", "_")
            module = importlib.import_module(f"app.plugins.{module_name}")

            if hasattr(module, "register"):
                module.register(app, manifest)
                loaded_names.append(manifest.get("name", plugin_name))
                _loaded_plugins.append(manifest)
                logger.info("[PLUGIN] %s v%s loaded", manifest.get("display_name", plugin_name), manifest.get("version", "?"))
            else:
                logger.warning("Plugin %s has no register() function", plugin_name)
        except Exception as e:
            logger.warning("Plugin %s failed to load: %s", plugin_name, e, exc_info=True)

    return loaded_names


def get_loaded_plugins() -> List[Dict[str, Any]]:
    """Return list of loaded plugin manifests."""
    return list(_loaded_plugins)


def get_all_plugin_status() -> List[Dict[str, Any]]:
    """Return all known plugins with loaded/unloaded status."""
    loaded_names = {p.get("name") for p in _loaded_plugins}
    result = []

    # First add loaded plugins (with full manifest)
    for manifest in _loaded_plugins:
        result.append({
            "name": manifest.get("name"),
            "display_name": manifest.get("display_name"),
            "display_name_en": manifest.get("display_name_en"),
            "version": manifest.get("version"),
            "description": manifest.get("description"),
            "loaded": True,
            "frontend": manifest.get("frontend", {}),
        })

    # Then add unloaded known plugins
    for name in ALL_KNOWN_PLUGINS:
        if name not in loaded_names:
            result.append({
                "name": name,
                "display_name": name,
                "display_name_en": name,
                "version": None,
                "description": None,
                "loaded": False,
                "frontend": {},
            })

    return result
