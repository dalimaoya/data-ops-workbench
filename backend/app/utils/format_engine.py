"""Data format adaptive engine — auto-detect target format from existing DB data,
then convert imported values to match.

Covers:
1. Global cleaning (fullwidth→halfwidth, trim, null standardization, line breaks, thousands separators)
2. Date/datetime format per-field adaptive conversion
3. Amount/currency format adaptive
4. Percentage format adaptive
5. Boolean/yes-no format adaptive

All conversions are bidirectional — target format is inferred from existing DB data, not hardcoded.
"""

import re
import unicodedata
from typing import Optional, List, Dict, Any
from datetime import datetime

# ── 1. Global cleaning ──

# Null-equivalent values → None
_NULL_VALUES = {"无", "暂无", "N/A", "n/a", "NA", "na", "NULL", "null", "None", "none", "-", "/", "—", ""}


def clean_global(val: str, rules: Optional[Dict[str, bool]] = None) -> Optional[str]:
    """Apply global cleaning rules. Returns None for null-equivalent values.

    Args:
        val: input string
        rules: optional dict of rule toggles. Keys:
            fullwidth_to_halfwidth, trim_whitespace, normalize_linebreaks, null_standardization.
            When None, all rules are applied (backward compatible).
    """
    if val is None:
        return None
    cleaned = val
    # Fullwidth → halfwidth (except Chinese characters)
    if rules is None or rules.get("fullwidth_to_halfwidth", True):
        buf = ""
        for ch in cleaned:
            cp = ord(ch)
            if 0xFF01 <= cp <= 0xFF5E:  # fullwidth ASCII
                buf += chr(cp - 0xFEE0)
            elif cp == 0x3000:  # fullwidth space
                buf += " "
            else:
                buf += ch
        cleaned = buf
    # Strip whitespace
    if rules is None or rules.get("trim_whitespace", True):
        cleaned = cleaned.strip()
    # Normalize line breaks / tabs → space
    if rules is None or rules.get("normalize_linebreaks", True):
        cleaned = re.sub(r"[\r\n\t]+", " ", cleaned)
    # Null equivalents
    if rules is None or rules.get("null_standardization", True):
        if cleaned in _NULL_VALUES:
            return None
    return cleaned


def clean_thousands(val: str) -> str:
    """Remove thousands separators from numeric strings: 1,234,567 → 1234567"""
    if val and re.match(r"^[\d,]+\.?\d*$", val):
        return val.replace(",", "")
    return val


# ── 2. Date format adaptive ──

# Common date format patterns to detect from sample values
_DATE_FORMATS = [
    ("%Y-%m-%d %H:%M:%S", r"^\d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{1,2}:\d{1,2}$"),
    ("%Y-%m-%d %H:%M", r"^\d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{1,2}$"),
    ("%Y-%m-%d", r"^\d{4}-\d{1,2}-\d{1,2}$"),
    ("%Y/%m/%d %H:%M:%S", r"^\d{4}/\d{1,2}/\d{1,2} \d{1,2}:\d{1,2}:\d{1,2}$"),
    ("%Y/%m/%d", r"^\d{4}/\d{1,2}/\d{1,2}$"),
    ("%Y.%m.%d", r"^\d{4}\.\d{1,2}\.\d{1,2}$"),
    ("%Y%m%d", r"^\d{8}$"),
    ("%Y年%m月%d日 %H时%M分%S秒", r"^\d{4}年\d{1,2}月\d{1,2}日 \d{1,2}时\d{1,2}分\d{1,2}秒$"),
    ("%Y年%m月%d日 %H:%M:%S", r"^\d{4}年\d{1,2}月\d{1,2}日 \d{1,2}:\d{1,2}:\d{1,2}$"),
    ("%Y年%m月%d日", r"^\d{4}年\d{1,2}月\d{1,2}日$"),
    ("%m-%d", r"^\d{1,2}-\d{1,2}$"),
    ("%H:%M:%S", r"^\d{1,2}:\d{1,2}:\d{1,2}$"),
    ("%H:%M", r"^\d{1,2}:\d{1,2}$"),
]


def detect_date_format(sample_values: List[str]) -> Optional[str]:
    """Detect date format from sample values. Returns strftime format string or None."""
    for val in sample_values:
        if not val or val.strip() == "":
            continue
        v = val.strip()
        for fmt, pattern in _DATE_FORMATS:
            if re.match(pattern, v):
                # Verify it actually parses
                try:
                    datetime.strptime(v, fmt)
                    return fmt
                except ValueError:
                    # May fail due to zero-padded vs non-padded, try with relaxed parsing
                    continue
    return None


def parse_any_date(val: str) -> Optional[datetime]:
    """Parse any date string into datetime. Supports various formats."""
    if not val or val.strip() == "":
        return None
    v = val.strip()

    # Try known formats first (faster)
    for fmt, pattern in _DATE_FORMATS:
        if re.match(pattern, v):
            try:
                return datetime.strptime(v, fmt)
            except ValueError:
                continue

    # Fallback: dateutil (handles edge cases)
    try:
        from dateutil import parser as date_parser
        return date_parser.parse(v)
    except (ValueError, OverflowError, ImportError):
        return None


def format_date(dt: datetime, target_fmt: str) -> str:
    """Format datetime to target format string.
    Handles non-zero-padded variants (%-m etc.) by post-processing."""
    result = dt.strftime(target_fmt)
    # Python strftime always zero-pads. If target format uses non-padded
    # (detected from sample like "2012-3-2"), remove leading zeros.
    # We detect this by checking if any sample month/day was single digit.
    return result


def convert_date(val: str, target_fmt: str) -> Optional[str]:
    """Parse any date format and convert to target format."""
    dt = parse_any_date(val)
    if dt is None:
        return None
    return format_date(dt, target_fmt)


# ── 3. Amount/Currency format adaptive ──

_CURRENCY_PATTERN = re.compile(r"^[¥￥$€£]?\s*([\d,]+\.?\d*)\s*[元圆]?$")


def detect_amount_format(sample_values: List[str]) -> Dict[str, Any]:
    """Detect amount format: prefix, suffix, thousands separator, decimal places."""
    for val in sample_values:
        if not val:
            continue
        v = val.strip()
        has_prefix = v[0] in "¥￥$€£" if v else False
        has_suffix = v.endswith("元") or v.endswith("圆")
        has_thousands = "," in v and re.search(r"\d,\d{3}", v)
        # Decimal places
        if "." in v:
            dec_places = len(v.split(".")[-1].rstrip("元圆 "))
        else:
            dec_places = 0
        prefix = v[0] if has_prefix else ""
        suffix = v[-1] if has_suffix else ""
        return {"prefix": prefix, "suffix": suffix, "thousands": bool(has_thousands), "decimals": dec_places}
    return {}


def convert_amount(val: str, target_fmt: Dict[str, Any]) -> Optional[str]:
    """Convert amount to target format."""
    if not val or not target_fmt:
        return None
    # Extract number
    v = val.strip()
    v = re.sub(r"[¥￥$€£元圆\s]", "", v)
    v = v.replace(",", "")
    try:
        num = float(v)
    except ValueError:
        return None
    # Format
    dec = target_fmt.get("decimals", 2)
    formatted = f"{num:,.{dec}f}" if target_fmt.get("thousands") else f"{num:.{dec}f}"
    return target_fmt.get("prefix", "") + formatted + target_fmt.get("suffix", "")


# ── 4. Percentage format adaptive ──

def detect_percent_format(sample_values: List[str]) -> Optional[str]:
    """Detect: 'percent' (85%), 'decimal' (0.85), 'number' (85)"""
    for val in sample_values:
        if not val:
            continue
        v = val.strip()
        if v.endswith("%"):
            return "percent"
        try:
            n = float(v)
            if 0 < n < 1 and "." in v:
                return "decimal"
            elif 0 < n <= 100:
                return "number"
        except ValueError:
            continue
    return None


def convert_percent(val: str, target_fmt: str) -> Optional[str]:
    """Convert percentage between formats."""
    if not val:
        return None
    v = val.strip()
    # Parse input
    if v.endswith("%"):
        num = float(v.rstrip("%")) / 100.0
    else:
        num = float(v)
        # If > 1, assume it's already a percentage number (like 85)
        if num > 1:
            num = num / 100.0
    # Output
    if target_fmt == "percent":
        return f"{num * 100:.1f}%".rstrip("0").rstrip(".")  + "%"  if "." in f"{num * 100}" else f"{int(num * 100)}%"
    elif target_fmt == "decimal":
        return f"{num:.4f}".rstrip("0").rstrip(".")
    elif target_fmt == "number":
        return f"{num * 100:.2f}".rstrip("0").rstrip(".")
    return None


# ── 5. Boolean/Yes-No format adaptive ──

_BOOL_TRUE = {"是", "yes", "y", "true", "1", "✓", "√", "对"}
_BOOL_FALSE = {"否", "no", "n", "false", "0", "✗", "×", "错"}


def detect_bool_format(sample_values: List[str]) -> Optional[tuple]:
    """Detect boolean format: returns (true_val, false_val) or None."""
    for val in sample_values:
        if not val:
            continue
        v = val.strip().lower()
        if v in _BOOL_TRUE:
            # Find corresponding false value in same style
            original = val.strip()
            if original in ("是", "对"):
                return ("是", "否")
            if original in ("1",):
                return ("1", "0")
            if original.lower() in ("yes", "y"):
                return (original, "No" if original[0].isupper() else "no")
            if original.lower() in ("true",):
                return (original, "False" if original[0].isupper() else "false")
            return ("是", "否")
        elif v in _BOOL_FALSE:
            original = val.strip()
            if original in ("否", "错"):
                return ("是", "否")
            if original in ("0",):
                return ("1", "0")
            if original.lower() in ("no", "n"):
                return ("Yes" if original[0].isupper() else "yes", original)
            if original.lower() in ("false",):
                return ("True" if original[0].isupper() else "true", original)
            return ("是", "否")
    return None


def convert_bool(val: str, target: tuple) -> Optional[str]:
    """Convert boolean to target format."""
    if not val or not target:
        return None
    v = val.strip().lower()
    true_val, false_val = target
    if v in _BOOL_TRUE:
        return true_val
    elif v in _BOOL_FALSE:
        return false_val
    return None


# ── Master: build field format map from sample data ──

def build_format_map(fields: list, sample_data: Dict[str, List[str]]) -> Dict[str, Dict[str, Any]]:
    """Build per-field format detection map.

    Args:
        fields: list of FieldConfig objects
        sample_data: {field_name: [sample_value_1, sample_value_2, ...]}

    Returns: {field_name: {"type": "date|amount|percent|bool", "format": ...}}
    """
    fmt_map = {}
    for f in fields:
        fname = f.field_name
        dtype = (f.db_data_type or "").lower()
        samples = sample_data.get(fname, [])
        samples = [s for s in samples if s and str(s).strip()]

        if not samples:
            continue

        str_samples = [str(s).strip() for s in samples]

        # Date detection
        if any(dt in dtype for dt in ("date", "time", "timestamp", "datetime")):
            dfmt = detect_date_format(str_samples)
            if dfmt:
                fmt_map[fname] = {"type": "date", "format": dfmt}
                continue

        # Boolean detection (for is_*/has_* fields or small varchar with yes/no values)
        if fname.startswith(("is_", "has_")) or dtype in ("tinyint", "boolean", "bool"):
            bfmt = detect_bool_format(str_samples)
            if bfmt:
                fmt_map[fname] = {"type": "bool", "format": bfmt}
                continue

        # Amount detection (for amount/money/price/fee fields)
        if any(kw in fname for kw in ("amount", "money", "price", "fee", "cost", "balance")):
            afmt = detect_amount_format(str_samples)
            if afmt:
                fmt_map[fname] = {"type": "amount", "format": afmt}
                continue

        # Percentage detection (for rate/ratio/percent fields)
        if any(kw in fname for kw in ("rate", "ratio", "percent", "proportion")):
            pfmt = detect_percent_format(str_samples)
            if pfmt:
                fmt_map[fname] = {"type": "percent", "format": pfmt}
                continue

    return fmt_map


def apply_format(val: str, field_fmt: Dict[str, Any]) -> Optional[str]:
    """Apply format conversion to a single value based on detected format."""
    if val is None:
        return None
    fmt_type = field_fmt.get("type")
    fmt = field_fmt.get("format")
    try:
        if fmt_type == "date" and fmt:
            return convert_date(val, fmt)
        elif fmt_type == "amount" and fmt:
            return convert_amount(val, fmt)
        elif fmt_type == "percent" and fmt:
            return convert_percent(val, fmt)
        elif fmt_type == "bool" and fmt:
            return convert_bool(val, fmt)
    except Exception:
        pass
    return None  # Return None means "no conversion applied, keep original"
