"""AI data validation API — POST /api/ai/data-validate."""

import time
import json
import re
import math
from collections import Counter
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import TableConfig, FieldConfig, DatasourceConfig, AIConfig
from app.utils.auth import get_current_user, require_role
from app.utils.crypto import decrypt_password
from app.utils.remote_db import _connect
from app.ai.ai_engine import AIEngine
from app.i18n import t

router = APIRouter(prefix="/api/ai", tags=["AI Data Validate"])


# ── Schemas ──

class DataValidateRequest(BaseModel):
    table_id: int
    import_data: List[Dict[str, Any]]
    checks: List[str] = ["outlier", "format", "duplicate", "cross_field"]


class ValidationWarning(BaseModel):
    row: int
    column: str
    field_name: Optional[str] = None
    value: Optional[str] = None
    check_type: str
    message: str
    detail: Optional[str] = None
    severity: str = "warning"
    historical_pattern: Optional[str] = None


# ── Default validation config ──

DEFAULT_VALIDATE_CONFIG = {
    "outlier_range": "p5_p95",      # p1_p99 / p5_p95 / p10_p90
    "outlier_stddev_factor": 3,     # flag values beyond N standard deviations
    "history_sample_size": 1000,
    "warning_behavior": "warn",     # warn / block
    "skip_fields": [],
}


def _get_validate_config(db: Session) -> dict:
    """Read AI validation config from ai_config feature_flags or system_settings."""
    from app.models import SystemSetting
    config = DEFAULT_VALIDATE_CONFIG.copy()

    # Try reading from system_setting
    for key in ("outlier_range", "outlier_stddev_factor", "history_sample_size", "warning_behavior", "skip_fields"):
        full_key = f"ai_validate_{key}"
        row = db.query(SystemSetting).filter(SystemSetting.setting_key == full_key).first()
        if row:
            if key in ("history_sample_size", "outlier_stddev_factor"):
                try:
                    config[key] = int(row.setting_value) if key == "history_sample_size" else float(row.setting_value)
                except ValueError:
                    pass
            elif key == "skip_fields":
                try:
                    config[key] = json.loads(row.setting_value)
                except (json.JSONDecodeError, TypeError):
                    config[key] = [s.strip() for s in row.setting_value.split(",") if s.strip()]
            else:
                config[key] = row.setting_value

    return config


def _get_percentile_bounds(values: List[float], range_key: str) -> tuple:
    """Return (lower, upper) percentile bounds."""
    if not values:
        return (0, 0)
    sorted_vals = sorted(values)
    n = len(sorted_vals)
    ranges = {
        "p1_p99": (1, 99),
        "p5_p95": (5, 95),
        "p10_p90": (10, 90),
    }
    low_pct, high_pct = ranges.get(range_key, (5, 95))

    def _percentile(pct):
        k = (n - 1) * pct / 100.0
        f = math.floor(k)
        c = math.ceil(k)
        if f == c:
            return sorted_vals[int(k)]
        d0 = sorted_vals[int(f)] * (c - k)
        d1 = sorted_vals[int(c)] * (k - f)
        return d0 + d1

    return (_percentile(low_pct), _percentile(high_pct))


def _is_numeric_column(db_data_type: str) -> bool:
    return bool(re.search(
        r"(int|integer|bigint|smallint|tinyint|float|double|decimal|numeric|real|number)",
        db_data_type, re.IGNORECASE
    ))


def _is_date_column(db_data_type: str) -> bool:
    return bool(re.search(r"(date|time|timestamp)", db_data_type, re.IGNORECASE))


def _try_float(val) -> Optional[float]:
    if val is None:
        return None
    try:
        return float(str(val).strip())
    except (ValueError, TypeError):
        return None


# ── Phone / date regex patterns ──

PHONE_PATTERNS = [
    (re.compile(r'^1[3-9]\d{9}$'), "11位手机号"),
    (re.compile(r'^0\d{2,3}-?\d{7,8}$'), "固定电话"),
    (re.compile(r'^\+?\d{1,4}-?\d{6,11}$'), "国际号码"),
]

DATE_PATTERNS = [
    (re.compile(r'^\d{4}-\d{2}-\d{2}$'), "YYYY-MM-DD"),
    (re.compile(r'^\d{4}/\d{1,2}/\d{1,2}$'), "YYYY/M/D"),
    (re.compile(r'^\d{4}\.\d{1,2}\.\d{1,2}$'), "YYYY.M.D"),
    (re.compile(r'^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$'), "YYYY-MM-DD HH:MM:SS"),
    (re.compile(r'^\d{4}/\d{1,2}/\d{1,2}\s+\d{2}:\d{2}:\d{2}$'), "YYYY/M/D HH:MM:SS"),
    (re.compile(r'^\d{8}$'), "YYYYMMDD"),
]

# Cross-field date pairs
DATE_PAIR_PATTERNS = [
    (r"start_(?:date|time)", r"end_(?:date|time)"),
    (r"begin_(?:date|time)", r"end_(?:date|time)"),
    (r"from_(?:date|time)", r"to_(?:date|time)"),
    (r"(?:create|created)_(?:at|time|date)", r"(?:update|updated|modify|modified)_(?:at|time|date)"),
]

# Cross-field min/max pairs
MINMAX_PAIR_PATTERNS = [
    (r"min_(\w+)", r"max_(\w+)"),
    (r"(\w+)_min", r"(\w+)_max"),
    (r"low_(\w+)", r"high_(\w+)"),
    (r"(\w+)_low", r"(\w+)_high"),
]


def _detect_phone_format(value: str) -> Optional[str]:
    """Detect phone number format."""
    for pat, name in PHONE_PATTERNS:
        if pat.match(value.strip()):
            return name
    return None


def _detect_date_format(value: str) -> Optional[str]:
    """Detect date string format."""
    for pat, name in DATE_PATTERNS:
        if pat.match(value.strip()):
            return name
    return None


def _sample_historical_data(ds: DatasourceConfig, tc: TableConfig, fields: List[FieldConfig],
                            sample_size: int) -> List[Dict[str, Any]]:
    """Sample historical data from remote business DB."""
    password = decrypt_password(ds.password_encrypted)
    conn = _connect(
        db_type=ds.db_type, host=ds.host, port=ds.port, user=ds.username,
        password=password, database=tc.db_name, schema=tc.schema_name,
        charset=ds.charset or "utf8", timeout=ds.connect_timeout_seconds or 10,
    )
    try:
        cur = conn.cursor()
        # Build qualified table name
        if ds.db_type in ("postgresql", "kingbase"):
            sch = tc.schema_name or "public"
            qt = f'"{sch}"."{tc.table_name}"'
        elif ds.db_type == "sqlserver":
            sch = tc.schema_name or "dbo"
            qt = f"[{sch}].[{tc.table_name}]"
        elif ds.db_type in ("oracle", "dm"):
            qt = f'"{tc.table_name.upper()}"'
        else:
            qt = f"`{tc.table_name}`"

        col_names = [f.field_name for f in fields]
        if ds.db_type in ("oracle", "dm"):
            cols_sql = ", ".join(f'"{c.upper()}"' for c in col_names)
        elif ds.db_type == "sqlserver":
            cols_sql = ", ".join(f"[{c}]" for c in col_names)
        elif ds.db_type in ("mysql", "sqlite"):
            cols_sql = ", ".join(f"`{c}`" for c in col_names)
        else:
            cols_sql = ", ".join(f'"{c}"' for c in col_names)

        # Limit query
        if ds.db_type == "sqlserver":
            cur.execute(f"SELECT TOP {sample_size} {cols_sql} FROM {qt}")
        elif ds.db_type in ("oracle", "dm"):
            cur.execute(f"SELECT {cols_sql} FROM {qt} WHERE ROWNUM <= {sample_size}")
        else:
            cur.execute(f"SELECT {cols_sql} FROM {qt} LIMIT {sample_size}")

        rows = cur.fetchall()
        result = []
        for row in rows:
            d = {}
            for i, col in enumerate(col_names):
                d[col] = str(row[i]) if row[i] is not None else None
            result.append(d)
        return result
    except Exception:
        return []
    finally:
        conn.close()


def _run_outlier_checks(import_data: List[Dict], historical_data: List[Dict],
                        fields: List[FieldConfig], config: dict,
                        skip_fields: set) -> List[dict]:
    """Detect outlier values in import data based on historical statistics."""
    warnings = []
    range_key = config.get("outlier_range", "p5_p95")

    stddev_factor = config.get("outlier_stddev_factor", 3)

    for field in fields:
        fname = field.field_name
        if fname in skip_fields or field.is_primary_key:
            continue  # Skip primary keys from outlier detection (they're expected to grow)

        is_numeric = _is_numeric_column(field.db_data_type)

        if is_numeric:
            # Numeric outlier: P-range based + stddev based
            hist_nums = [_try_float(r.get(fname)) for r in historical_data]
            hist_nums = [v for v in hist_nums if v is not None]
            if len(hist_nums) < 5:
                continue

            lower, upper = _get_percentile_bounds(hist_nums, range_key)

            # Also compute mean/stddev for 3-sigma detection
            avg = sum(hist_nums) / len(hist_nums)
            variance = sum((x - avg) ** 2 for x in hist_nums) / len(hist_nums)
            stddev = variance ** 0.5
            sigma_lower = avg - stddev_factor * stddev
            sigma_upper = avg + stddev_factor * stddev

            flagged_rows = set()  # avoid duplicate warnings for same cell

            for i, row in enumerate(import_data):
                val = _try_float(row.get(fname))
                if val is None:
                    continue
                row_num = row.get("_row_num", i + 2)

                # Percentile range check
                if val < lower or val > upper:
                    range_label = range_key.replace("p", "P").replace("_", "-")
                    warnings.append({
                        "row": row_num,
                        "column": field.field_alias or fname,
                        "field_name": fname,
                        "value": str(row.get(fname, "")),
                        "check_type": "outlier",
                        "message": f"数值偏离正常范围（{range_label}: {lower:.2f} ~ {upper:.2f}）",
                        "detail": f"历史数据{range_label}范围为 {lower:.2f} ~ {upper:.2f}，当前值 {val}",
                        "severity": "warning",
                        "historical_pattern": f"{lower:.2f}~{upper:.2f}",
                    })
                    flagged_rows.add(row_num)

                # 3-sigma stddev check (only if not already flagged by percentile)
                if row_num not in flagged_rows and stddev > 0:
                    if val < sigma_lower or val > sigma_upper:
                        deviation = abs(val - avg) / stddev
                        warnings.append({
                            "row": row_num,
                            "column": field.field_alias or fname,
                            "field_name": fname,
                            "value": str(row.get(fname, "")),
                            "check_type": "outlier",
                            "message": f"数值偏离 {deviation:.1f} 倍标准差（均值 {avg:.2f}，标准差 {stddev:.2f}）",
                            "detail": f"历史均值 {avg:.2f}，标准差 {stddev:.2f}，当前值 {val} 偏离 {deviation:.1f}σ",
                            "severity": "warning" if deviation < stddev_factor * 2 else "error",
                            "historical_pattern": f"μ={avg:.2f}, σ={stddev:.2f}",
                        })
        else:
            # Text length outlier
            hist_lens = []
            for r in historical_data:
                v = r.get(fname)
                if v is not None:
                    hist_lens.append(len(v))
            if len(hist_lens) < 5:
                continue

            avg_len = sum(hist_lens) / len(hist_lens)
            std_len = (sum((l - avg_len) ** 2 for l in hist_lens) / len(hist_lens)) ** 0.5
            if std_len < 1:
                std_len = 1

            for i, row in enumerate(import_data):
                v = row.get(fname)
                if v is None:
                    continue
                cur_len = len(v)
                # Flag if length is beyond 3 standard deviations
                if avg_len > 0 and abs(cur_len - avg_len) > 3 * std_len and abs(cur_len - avg_len) > 10:
                    direction = "远超" if cur_len > avg_len else "远短于"
                    warnings.append({
                        "row": row.get("_row_num", i + 2),
                        "column": field.field_alias or fname,
                        "field_name": fname,
                        "value": v[:50] + ("..." if len(v) > 50 else ""),
                        "check_type": "outlier",
                        "message": f"文本长度{direction}历史平均（平均 {avg_len:.0f} 字符，当前 {cur_len} 字符）",
                        "detail": f"历史平均长度 {avg_len:.0f}±{std_len:.0f}，当前长度 {cur_len}",
                        "severity": "warning",
                    })

    return warnings


def _run_format_checks(import_data: List[Dict], historical_data: List[Dict],
                       fields: List[FieldConfig], skip_fields: set) -> List[dict]:
    """Detect format inconsistencies."""
    warnings = []

    for field in fields:
        fname = field.field_name
        if fname in skip_fields:
            continue

        # Determine if field looks like phone/date/code
        fname_lower = fname.lower()
        is_phone = any(kw in fname_lower for kw in ("phone", "mobile", "tel", "手机", "电话"))
        is_date_text = any(kw in fname_lower for kw in ("date", "time", "日期", "时间"))
        is_code = any(kw in fname_lower for kw in ("code", "no", "编码", "编号", "number"))

        if is_phone:
            # Detect dominant phone format in history
            hist_formats = Counter()
            for r in historical_data:
                v = r.get(fname)
                if v:
                    fmt = _detect_phone_format(v)
                    if fmt:
                        hist_formats[fmt] += 1

            if hist_formats:
                dominant_fmt = hist_formats.most_common(1)[0][0]
                dominant_pct = hist_formats.most_common(1)[0][1] / sum(hist_formats.values())

                if dominant_pct > 0.8:  # 80%+ same format
                    for i, row in enumerate(import_data):
                        v = row.get(fname)
                        if not v:
                            continue
                        cur_fmt = _detect_phone_format(v)
                        if cur_fmt and cur_fmt != dominant_fmt:
                            warnings.append({
                                "row": row.get("_row_num", i + 2),
                                "column": field.field_alias or fname,
                                "value": v,
                                "field_name": fname,
                                "check_type": "format",
                                "message": f"格式与历史数据不一致（历史主流: {dominant_fmt}，当前: {cur_fmt}）",
                                "detail": f"历史数据中 {dominant_pct*100:.0f}% 为{dominant_fmt}格式",
                                "severity": "warning",
                                "historical_pattern": dominant_fmt,
                            })

        if is_date_text and not _is_date_column(field.db_data_type):
            # Date text format consistency
            hist_formats = Counter()
            for r in historical_data:
                v = r.get(fname)
                if v:
                    fmt = _detect_date_format(v)
                    if fmt:
                        hist_formats[fmt] += 1

            if hist_formats:
                dominant_fmt = hist_formats.most_common(1)[0][0]
                dominant_pct = hist_formats.most_common(1)[0][1] / sum(hist_formats.values())

                if dominant_pct > 0.7:
                    for i, row in enumerate(import_data):
                        v = row.get(fname)
                        if not v:
                            continue
                        cur_fmt = _detect_date_format(v)
                        if cur_fmt and cur_fmt != dominant_fmt:
                            warnings.append({
                                "row": row.get("_row_num", i + 2),
                                "column": field.field_alias or fname,
                                "value": v,
                                "field_name": fname,
                                "check_type": "format",
                                "message": f"日期格式不统一（历史: {dominant_fmt}，当前: {cur_fmt}）",
                                "detail": f"历史数据中 {dominant_pct*100:.0f}% 使用 {dominant_fmt} 格式",
                                "severity": "warning",
                                "historical_pattern": dominant_fmt,
                            })

        if is_code:
            # Code prefix/length consistency
            hist_prefixes = Counter()
            hist_lengths = Counter()
            for r in historical_data:
                v = r.get(fname)
                if v and len(v) >= 2:
                    # Extract prefix (non-digit part)
                    prefix_match = re.match(r'^([A-Za-z_-]+)', v)
                    if prefix_match:
                        hist_prefixes[prefix_match.group(1)] += 1
                    hist_lengths[len(v)] += 1

            if hist_prefixes:
                dominant_prefix = hist_prefixes.most_common(1)[0][0]
                dominant_pct = hist_prefixes.most_common(1)[0][1] / sum(hist_prefixes.values())

                if dominant_pct > 0.8:
                    for i, row in enumerate(import_data):
                        v = row.get(fname)
                        if not v:
                            continue
                        prefix_match = re.match(r'^([A-Za-z_-]+)', v)
                        if prefix_match and prefix_match.group(1) != dominant_prefix:
                            warnings.append({
                                "row": row.get("_row_num", i + 2),
                                "column": field.field_alias or fname,
                                "value": v,
                                "field_name": fname,
                                "check_type": "format",
                                "message": f"编码前缀不一致（历史: {dominant_prefix}，当前: {prefix_match.group(1)}）",
                                "detail": f"历史数据中 {dominant_pct*100:.0f}% 以 '{dominant_prefix}' 开头",
                                "severity": "warning",
                                "historical_pattern": f"{dominant_prefix}*",
                            })

            if hist_lengths:
                dominant_len = hist_lengths.most_common(1)[0][0]
                dominant_pct = hist_lengths.most_common(1)[0][1] / sum(hist_lengths.values())

                if dominant_pct > 0.8:
                    for i, row in enumerate(import_data):
                        v = row.get(fname)
                        if not v:
                            continue
                        if len(v) != dominant_len:
                            warnings.append({
                                "row": row.get("_row_num", i + 2),
                                "column": field.field_alias or fname,
                                "value": v,
                                "field_name": fname,
                                "check_type": "format",
                                "message": f"编码长度不一致（历史: {dominant_len}位，当前: {len(v)}位）",
                                "detail": f"历史数据中 {dominant_pct*100:.0f}% 长度为 {dominant_len}",
                                "severity": "warning",
                            })

    return warnings


def _run_duplicate_checks(import_data: List[Dict], historical_data: List[Dict],
                          fields: List[FieldConfig], skip_fields: set) -> List[dict]:
    """Detect duplicate/constant value issues."""
    warnings = []

    for field in fields:
        fname = field.field_name
        if fname in skip_fields or field.is_primary_key:
            continue

        import_vals = [row.get(fname) for row in import_data if row.get(fname) is not None]
        if not import_vals:
            continue

        # Check: all same value in import data (non-pk column)
        unique_import = set(import_vals)
        if len(import_vals) > 3 and len(unique_import) == 1:
            warnings.append({
                "row": 0,
                "column": field.field_alias or fname,
                "value": str(list(unique_import)[0])[:50],
                "field_name": fname,
                "check_type": "duplicate",
                "message": f"导入数据的 {field.field_alias or fname} 列所有值都相同（{list(unique_import)[0]}），可能是批量填充错误",
                "detail": f"共 {len(import_vals)} 行数据全部为同一值",
                "severity": "warning",
            })

        # Check: historically unique field now has duplicates
        hist_vals = [r.get(fname) for r in historical_data if r.get(fname) is not None]
        if hist_vals:
            hist_unique = set(hist_vals)
            hist_unique_ratio = len(hist_unique) / len(hist_vals) if hist_vals else 0

            if hist_unique_ratio > 0.95:  # Historically ~unique
                import_dup_counter = Counter(import_vals)
                dups = {v: c for v, c in import_dup_counter.items() if c > 1}
                if dups:
                    # Report first few duplicates
                    for dup_val, dup_count in list(dups.items())[:3]:
                        dup_rows = [row.get("_row_num", idx + 2) for idx, row in enumerate(import_data)
                                    if row.get(fname) == dup_val]
                        warnings.append({
                            "row": dup_rows[0] if dup_rows else 0,
                            "column": field.field_alias or fname,
                            "value": str(dup_val)[:50],
                            "field_name": fname,
                "check_type": "duplicate",
                            "message": f"历史数据中该字段值唯一，但导入数据出现重复（值 '{str(dup_val)[:30]}' 出现 {dup_count} 次）",
                            "detail": f"历史唯一率 {hist_unique_ratio*100:.0f}%，重复出现在行: {dup_rows[:5]}",
                            "severity": "warning",
                        })

    return warnings


def _run_cross_field_checks(import_data: List[Dict], fields: List[FieldConfig],
                            skip_fields: set) -> List[dict]:
    """Detect cross-field logical inconsistencies."""
    warnings = []
    field_names = {f.field_name for f in fields}

    # Find date pairs
    for start_pat, end_pat in DATE_PAIR_PATTERNS:
        start_fields = [f for f in fields if re.match(start_pat, f.field_name.lower()) and f.field_name not in skip_fields]
        end_fields = [f for f in fields if re.match(end_pat, f.field_name.lower()) and f.field_name not in skip_fields]

        for sf in start_fields:
            for ef in end_fields:
                for i, row in enumerate(import_data):
                    sv = row.get(sf.field_name)
                    ev = row.get(ef.field_name)
                    if sv and ev:
                        try:
                            if str(sv).strip() > str(ev).strip():
                                warnings.append({
                                    "row": row.get("_row_num", i + 2),
                                    "column": f"{sf.field_alias or sf.field_name} / {ef.field_alias or ef.field_name}",
                                    "value": f"{sv} > {ev}",
                                    "field_name": sf.field_name,
                                    "check_type": "cross_field",
                                    "message": f"{sf.field_alias or sf.field_name}({sv}) 晚于 {ef.field_alias or ef.field_name}({ev})",
                                    "detail": "开始日期不应晚于结束日期",
                                    "severity": "warning",
                                })
                        except Exception:
                            pass

    # Find min/max pairs
    for min_pat, max_pat in MINMAX_PAIR_PATTERNS:
        for f in fields:
            min_match = re.match(min_pat, f.field_name.lower())
            if not min_match:
                continue
            # Try to find corresponding max field
            for f2 in fields:
                max_match = re.match(max_pat, f2.field_name.lower())
                if not max_match:
                    continue
                # Check if they match (same suffix)
                if min_match.group(1) == max_match.group(1):
                    if f.field_name in skip_fields or f2.field_name in skip_fields:
                        continue
                    for i, row in enumerate(import_data):
                        min_v = _try_float(row.get(f.field_name))
                        max_v = _try_float(row.get(f2.field_name))
                        if min_v is not None and max_v is not None and min_v > max_v:
                            warnings.append({
                                "row": row.get("_row_num", i + 2),
                                "column": f"{f.field_alias or f.field_name} / {f2.field_alias or f2.field_name}",
                                "value": f"{min_v} > {max_v}",
                                "field_name": f.field_name,
                                "check_type": "cross_field",
                                "message": f"最小值({min_v}) 大于 最大值({max_v})",
                                "detail": f"{f.field_alias or f.field_name} 不应大于 {f2.field_alias or f2.field_name}",
                                "severity": "warning",
                            })

    return warnings


async def _llm_enhance(engine: AIEngine, warnings: List[dict], import_data: List[Dict],
                       historical_summary: dict) -> List[dict]:
    """Optional LLM enhancement: send stats to LLM for deeper analysis."""
    client = engine.get_llm_client()
    if not client:
        return warnings

    try:
        # Build concise summary for LLM
        summary = json.dumps({
            "import_row_count": len(import_data),
            "historical_stats": historical_summary,
            "rule_warnings_count": len(warnings),
            "rule_warning_types": dict(Counter(w["check_type"] for w in warnings)),
        }, ensure_ascii=False)

        prompt = f"""你是一个数据质量分析助手。以下是导入数据的统计摘要和已检测到的规则警告。
请分析是否有其他潜在的数据质量问题需要关注。

数据摘要：
{summary}

已有规则警告前3条：
{json.dumps(warnings[:3], ensure_ascii=False)}

请返回JSON数组，每个元素包含：check_type, message, severity("warning"/"info")
如果没有额外发现，返回空数组 []。只返回JSON，不要其他文字。"""

        resp = await client.chat([
            {"role": "system", "content": "你是数据质量分析助手。只返回JSON数组，不要其他文字。"},
            {"role": "user", "content": prompt},
        ], timeout=15.0)

        content = resp.get("content", "").strip()
        json_match = re.search(r'\[.*\]', content, re.DOTALL)
        if json_match:
            extra = json.loads(json_match.group())
            for item in extra:
                if item.get("message"):
                    warnings.append({
                        "row": 0,
                        "column": item.get("column", "整体"),
                        "value": None,
                        "check_type": item.get("check_type", "ai_insight"),
                        "message": f"[AI] {item['message']}",
                        "detail": item.get("detail"),
                        "severity": item.get("severity", "info"),
                    })
    except Exception:
        pass  # LLM failure: degrade gracefully

    return warnings


# ── Main Endpoint ──

@router.post("/data-validate")
async def data_validate(
    body: DataValidateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """AI-powered data validation for import data."""
    start = time.time()

    # 1. Check AI feature enabled
    engine = AIEngine(db)
    if not engine.is_enabled or not engine.is_feature_enabled("data_validate"):
        raise HTTPException(400, t("ai.validate_not_enabled"))

    # 2. Get table config & datasource
    tc = db.query(TableConfig).filter(
        TableConfig.id == body.table_id, TableConfig.is_deleted == 0
    ).first()
    if not tc:
        raise HTTPException(404, t("ai_validate.table_not_found"))

    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == tc.datasource_id, DatasourceConfig.is_deleted == 0
    ).first()
    if not ds:
        raise HTTPException(404, t("ai_validate.datasource_not_found"))

    # 3. Get field configs
    fields = (
        db.query(FieldConfig)
        .filter(FieldConfig.table_config_id == tc.id, FieldConfig.is_deleted == 0)
        .order_by(FieldConfig.field_order_no)
        .all()
    )

    # 4. Get validation config
    validate_config = _get_validate_config(db)
    skip_fields = set(validate_config.get("skip_fields", []))

    # 5. Sample historical data
    sample_size = validate_config.get("history_sample_size", 1000)
    historical_data = _sample_historical_data(ds, tc, fields, sample_size)

    if not historical_data:
        return {
            "success": True,
            "data": {
                "warnings": [],
                "stats": {
                    "rows_checked": len(body.import_data),
                    "warnings_count": 0,
                    "check_elapsed_ms": int((time.time() - start) * 1000),
                    "historical_rows": 0,
                },
                "message": t("ai.no_history_data"),
            },
        }

    # 6. Run requested checks
    all_warnings = []
    checks = set(body.checks)

    if "outlier" in checks:
        all_warnings.extend(_run_outlier_checks(body.import_data, historical_data, fields, validate_config, skip_fields))

    if "format" in checks:
        all_warnings.extend(_run_format_checks(body.import_data, historical_data, fields, skip_fields))

    if "duplicate" in checks:
        all_warnings.extend(_run_duplicate_checks(body.import_data, historical_data, fields, skip_fields))

    if "cross_field" in checks:
        all_warnings.extend(_run_cross_field_checks(body.import_data, fields, skip_fields))

    # 7. Optional LLM enhancement
    if engine.engine_mode == "cloud" and engine.is_feature_enabled("data_validate"):
        historical_summary = {
            "total_rows": len(historical_data),
            "fields": len(fields),
        }
        all_warnings = await _llm_enhance(engine, all_warnings, body.import_data, historical_summary)

    elapsed = int((time.time() - start) * 1000)

    error_items = [w for w in all_warnings if w.get("severity") == "error"]
    warning_items = [w for w in all_warnings if w.get("severity") != "error"]

    return {
        "success": True,
        "data": {
            "warnings": all_warnings,
            "stats": {
                "rows_checked": len(body.import_data),
                "total_issues": len(all_warnings),
                "error_count": len(error_items),
                "warning_count": len(warning_items),
                "warnings_count": len(all_warnings),  # backward compat
                "check_elapsed_ms": elapsed,
                "historical_rows": len(historical_data),
            },
            "has_errors": len(error_items) > 0,
            "warning_behavior": validate_config.get("warning_behavior", "warn"),
        },
    }
