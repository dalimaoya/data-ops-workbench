"""Backend i18n module: provides message translation based on Accept-Language header."""

from __future__ import annotations

import json
import os
from typing import Optional
from contextvars import ContextVar
from fastapi import Request

# Current language context variable (per-request)
_current_lang: ContextVar[str] = ContextVar("current_lang", default="zh")

# Translation dictionaries
_translations: dict[str, dict[str, str]] = {}

_LOCALE_DIR = os.path.join(os.path.dirname(__file__), "locales")


def _load_translations():
    """Load all locale JSON files."""
    global _translations
    for fname in os.listdir(_LOCALE_DIR):
        if fname.endswith(".json"):
            lang = fname[:-5]  # e.g. "zh.json" -> "zh"
            with open(os.path.join(_LOCALE_DIR, fname), "r", encoding="utf-8") as f:
                _translations[lang] = json.load(f)


def get_lang() -> str:
    """Get current request language."""
    return _current_lang.get()


def set_lang(lang: str):
    """Set current request language."""
    _current_lang.set(lang)


def parse_accept_language(header: Optional[str]) -> str:
    """Parse Accept-Language header and return best matching language code."""
    if not header:
        return "zh"
    # Simple parsing: look for 'en' or 'zh' in the header
    header_lower = header.lower()
    # Check for explicit language tags
    if header_lower.startswith("en") or ",en" in header_lower or ";en" in header_lower:
        return "en"
    if header_lower.startswith("zh") or ",zh" in header_lower or ";zh" in header_lower:
        return "zh"
    # More detailed parsing with quality values
    parts = header_lower.split(",")
    best_lang = "zh"
    best_q = -1
    for part in parts:
        part = part.strip()
        if ";q=" in part:
            lang_part, q_part = part.split(";q=", 1)
            try:
                q = float(q_part.strip())
            except ValueError:
                q = 0
        else:
            lang_part = part
            q = 1.0
        lang_part = lang_part.strip()
        if lang_part.startswith("en") and q > best_q:
            best_lang = "en"
            best_q = q
        elif lang_part.startswith("zh") and q > best_q:
            best_lang = "zh"
            best_q = q
    return best_lang


def t(key: str, **kwargs) -> str:
    """Translate a message key to the current language.
    
    Usage:
        t("datasource.not_found")
        t("field.updated_count", count=3)
    """
    lang = get_lang()
    translations = _translations.get(lang, _translations.get("zh", {}))
    msg = translations.get(key)
    if msg is None:
        # Fallback to Chinese
        msg = _translations.get("zh", {}).get(key)
    if msg is None:
        # Return the key itself as last resort
        return key
    if kwargs:
        try:
            msg = msg.format(**kwargs)
        except (KeyError, IndexError):
            pass
    return msg


# Load translations on import
_load_translations()
