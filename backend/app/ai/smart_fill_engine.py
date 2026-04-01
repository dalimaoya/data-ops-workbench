"""Smart Fill Engine — detect patterns in existing data and suggest values for blank cells.

Pattern detection strategies (ordered by priority):
1. Increment detection — numeric sequences (1,2,3,...) or date sequences
2. Frequency fill — most common value in the column
3. Association fill — infer value from correlated columns (e.g. department→owner)
4. LLM enhanced — call LLM for complex pattern recognition (optional)
"""

import re
import json
from datetime import datetime, timedelta
from typing import Optional
from collections import Counter


# ── Pattern detection helpers ──

def _is_numeric(val: str) -> bool:
    try:
        float(val)
        return True
    except (ValueError, TypeError):
        return False


def _parse_date(val: str) -> Optional[datetime]:
    """Try to parse a date string in common formats."""
    formats = [
        "%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d",
        "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S",
        "%Y%m%d", "%d-%m-%Y", "%d/%m/%Y",
        "%Y年%m月%d日",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(val.strip(), fmt)
        except (ValueError, TypeError):
            continue
    return None


def _detect_date_format(val: str) -> Optional[str]:
    """Return the matching datetime format string."""
    formats = [
        "%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d",
        "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S",
        "%Y%m%d", "%d-%m-%Y", "%d/%m/%Y",
        "%Y年%m月%d日",
    ]
    for fmt in formats:
        try:
            datetime.strptime(val.strip(), fmt)
            return fmt
        except (ValueError, TypeError):
            continue
    return None


# ── Pattern detectors ──

def detect_numeric_increment(values_with_index: list[tuple[int, Optional[str]]]) -> Optional[dict]:
    """Detect numeric increment pattern.
    
    values_with_index: [(row_index, cell_value_or_None), ...]
    Returns pattern dict or None.
    """
    filled = [(i, float(v)) for i, v in values_with_index if v is not None and _is_numeric(v)]
    if len(filled) < 2:
        return None

    # Check if there's a consistent step between consecutive filled values
    deltas = []
    for k in range(1, len(filled)):
        row_gap = filled[k][0] - filled[k - 1][0]
        val_gap = filled[k][1] - filled[k - 1][1]
        if row_gap == 0:
            continue
        per_row = val_gap / row_gap
        deltas.append(per_row)

    if not deltas:
        return None

    # Check consistency (allow small float error)
    avg_delta = sum(deltas) / len(deltas)
    if avg_delta == 0:
        return None

    variance = sum((d - avg_delta) ** 2 for d in deltas) / len(deltas)
    # Relative tolerance
    if abs(avg_delta) > 0 and (variance ** 0.5) / abs(avg_delta) > 0.05:
        return None

    # Check if values are integers
    is_int = all(v == int(v) for _, v in filled)

    return {
        "type": "numeric_increment",
        "step_per_row": avg_delta,
        "is_integer": is_int,
        "confidence": 0.95 if len(filled) >= 3 else 0.75,
        "description": f"数字递增，每行{'增加' if avg_delta > 0 else '减少'} {abs(avg_delta):.4g}",
    }


def detect_date_increment(values_with_index: list[tuple[int, Optional[str]]]) -> Optional[dict]:
    """Detect date increment pattern."""
    filled = []
    date_fmt = None
    for i, v in values_with_index:
        if v is not None:
            d = _parse_date(v)
            if d is not None:
                filled.append((i, d))
                if date_fmt is None:
                    date_fmt = _detect_date_format(v)

    if len(filled) < 2 or date_fmt is None:
        return None

    # Check consistent day deltas
    day_deltas = []
    for k in range(1, len(filled)):
        row_gap = filled[k][0] - filled[k - 1][0]
        if row_gap == 0:
            continue
        total_days = (filled[k][1] - filled[k - 1][1]).days
        per_row = total_days / row_gap
        day_deltas.append(per_row)

    if not day_deltas:
        return None

    avg_days = sum(day_deltas) / len(day_deltas)
    if avg_days == 0:
        return None

    variance = sum((d - avg_days) ** 2 for d in day_deltas) / len(day_deltas)
    if abs(avg_days) > 0 and (variance ** 0.5) / abs(avg_days) > 0.1:
        return None

    return {
        "type": "date_increment",
        "days_per_row": round(avg_days, 2),
        "date_format": date_fmt,
        "confidence": 0.90 if len(filled) >= 3 else 0.70,
        "description": f"日期递增，每行间隔约 {abs(round(avg_days))} 天",
    }


def detect_frequency(values_with_index: list[tuple[int, Optional[str]]]) -> Optional[dict]:
    """Detect most frequent value — fallback strategy."""
    filled_vals = [v for _, v in values_with_index if v is not None and v.strip() != ""]
    if not filled_vals:
        return None

    counter = Counter(filled_vals)
    total = len(filled_vals)
    most_common_val, most_common_count = counter.most_common(1)[0]
    freq_ratio = most_common_count / total

    if freq_ratio < 0.3:
        # Too diverse, frequency fill not meaningful
        return None

    return {
        "type": "frequency",
        "value": most_common_val,
        "frequency": freq_ratio,
        "confidence": min(0.9, freq_ratio),
        "description": f"最常见值「{most_common_val}」（出现 {most_common_count}/{total} 次，占比 {freq_ratio:.0%}）",
    }


def detect_association(
    target_field: str,
    data: list[dict],
    fields: list[dict],
) -> Optional[dict]:
    """Detect association pattern — infer target from correlated fields.
    
    E.g., if department→owner is consistent, we can predict owner from department.
    """
    non_target_fields = [
        f["field_name"] for f in fields
        if f["field_name"] != target_field
        and not f.get("is_primary_key")
        and not f.get("is_system_field")
    ]

    # Rows where target is filled
    filled_rows = [r for r in data if r.get(target_field) is not None and str(r[target_field]).strip() != ""]
    if len(filled_rows) < 3:
        return None

    best_source = None
    best_mapping = None
    best_confidence = 0.0

    for src_field in non_target_fields:
        # Build mapping: src_value -> target_value
        mapping: dict[str, Counter] = {}
        for row in filled_rows:
            sv = row.get(src_field)
            tv = row.get(target_field)
            if sv is None or tv is None:
                continue
            sv_str = str(sv).strip()
            tv_str = str(tv).strip()
            if sv_str == "" or tv_str == "":
                continue
            if sv_str not in mapping:
                mapping[sv_str] = Counter()
            mapping[sv_str][tv_str] += 1

        if not mapping:
            continue

        # Calculate determinism: how often does a src value map to one target value?
        total_pairs = 0
        dominant_pairs = 0
        resolved_mapping = {}
        for sv, tv_counter in mapping.items():
            most_common_tv, count = tv_counter.most_common(1)[0]
            total_for_sv = sum(tv_counter.values())
            total_pairs += total_for_sv
            dominant_pairs += count
            resolved_mapping[sv] = most_common_tv

        if total_pairs == 0:
            continue

        confidence = dominant_pairs / total_pairs
        if confidence > best_confidence and confidence >= 0.7:
            best_source = src_field
            best_mapping = resolved_mapping
            best_confidence = confidence

    if best_source is None or best_mapping is None:
        return None

    # Find alias for source field
    src_alias = best_source
    for f in fields:
        if f["field_name"] == best_source:
            src_alias = f.get("field_alias") or best_source
            break

    return {
        "type": "association",
        "source_field": best_source,
        "source_alias": src_alias,
        "mapping": best_mapping,
        "confidence": round(best_confidence, 2),
        "description": f"关联填充：根据【{src_alias}】推断（准确率 {best_confidence:.0%}）",
    }


# ── Main detection orchestrator ──

def detect_patterns_for_field(
    target_field: str,
    data: list[dict],
    fields: list[dict],
) -> list[dict]:
    """Run all pattern detectors on a field and return matching patterns sorted by confidence."""
    values_with_index = [
        (i, str(row[target_field]) if row.get(target_field) is not None and str(row[target_field]).strip() != "" else None)
        for i, row in enumerate(data)
    ]

    patterns = []

    # 1. Numeric increment
    p = detect_numeric_increment(values_with_index)
    if p:
        patterns.append(p)

    # 2. Date increment
    p = detect_date_increment(values_with_index)
    if p:
        patterns.append(p)

    # 3. Association (needs full data)
    p = detect_association(target_field, data, fields)
    if p:
        patterns.append(p)

    # 4. Frequency (lowest priority)
    p = detect_frequency(values_with_index)
    if p:
        patterns.append(p)

    # Sort by confidence desc
    patterns.sort(key=lambda x: x.get("confidence", 0), reverse=True)
    return patterns


def generate_fill_suggestions(
    target_field: str,
    pattern: dict,
    data: list[dict],
    fields: list[dict],
) -> list[dict]:
    """Generate fill suggestions for blank rows based on the selected pattern.
    
    Returns: [{"row_index": int, "suggested_value": str, "confidence": float}, ...]
    """
    suggestions = []
    pattern_type = pattern.get("type", "")

    # Index of all filled values for reference
    filled = [(i, row.get(target_field)) for i, row in enumerate(data)
              if row.get(target_field) is not None and str(row[target_field]).strip() != ""]
    blank_indices = [i for i, row in enumerate(data)
                     if row.get(target_field) is None or str(row.get(target_field, "")).strip() == ""]

    if not blank_indices:
        return []

    if pattern_type == "numeric_increment":
        step = pattern["step_per_row"]
        is_int = pattern.get("is_integer", False)
        # Find the nearest filled value before each blank
        for bi in blank_indices:
            # Find closest filled row
            nearest = None
            for fi, fv in filled:
                if fv is not None and _is_numeric(str(fv)):
                    if nearest is None or abs(fi - bi) < abs(nearest[0] - bi):
                        nearest = (fi, float(str(fv)))
            if nearest is None:
                continue
            predicted = nearest[1] + step * (bi - nearest[0])
            if is_int:
                predicted = int(round(predicted))
            suggestions.append({
                "row_index": bi,
                "suggested_value": str(predicted) if not is_int else str(int(predicted)),
                "confidence": pattern["confidence"],
            })

    elif pattern_type == "date_increment":
        days_per_row = pattern["days_per_row"]
        date_fmt = pattern["date_format"]
        for bi in blank_indices:
            nearest = None
            for fi, fv in filled:
                d = _parse_date(str(fv)) if fv is not None else None
                if d is not None:
                    if nearest is None or abs(fi - bi) < abs(nearest[0] - bi):
                        nearest = (fi, d)
            if nearest is None:
                continue
            delta_days = days_per_row * (bi - nearest[0])
            predicted_date = nearest[1] + timedelta(days=delta_days)
            suggestions.append({
                "row_index": bi,
                "suggested_value": predicted_date.strftime(date_fmt),
                "confidence": pattern["confidence"],
            })

    elif pattern_type == "frequency":
        fill_value = pattern["value"]
        conf = pattern["confidence"]
        for bi in blank_indices:
            suggestions.append({
                "row_index": bi,
                "suggested_value": fill_value,
                "confidence": conf,
            })

    elif pattern_type == "association":
        mapping = pattern.get("mapping", {})
        src_field = pattern.get("source_field", "")
        conf = pattern["confidence"]
        for bi in blank_indices:
            src_val = data[bi].get(src_field)
            if src_val is not None:
                sv_str = str(src_val).strip()
                if sv_str in mapping:
                    suggestions.append({
                        "row_index": bi,
                        "suggested_value": mapping[sv_str],
                        "confidence": conf,
                    })

    return suggestions


# ── LLM-enhanced pattern recognition ──

SMART_FILL_SYSTEM_PROMPT = """你是一个数据模式识别助手。给定一列数据（部分有值、部分为空），分析数据规律并为空白处推荐填充值。

字段信息：
- 字段名：{field_name}
- 字段别名：{field_alias}
- 数据类型：{data_type}

已有数据样本（格式：行号:值）：
{sample_data}

空白行号列表：{blank_indices}

请分析数据规律，为每个空白行推荐一个填充值。

输出严格 JSON 格式（不要包含 markdown 代码块标记）：
{{
  "pattern_description": "检测到的模式描述",
  "confidence": 0.0到1.0的置信度,
  "suggestions": [
    {{"row_index": 行号, "value": "推荐值"}},
    ...
  ]
}}

注意：
1. 如果看不出明显规律，将 confidence 设为低值（<0.5）
2. suggestions 只包含空白行的推荐
3. 推荐值的格式应与已有数据保持一致
"""


def build_llm_smart_fill_prompt(
    field_name: str,
    field_alias: str,
    data_type: str,
    data: list[dict],
    blank_indices: list[int],
    max_sample: int = 50,
) -> list[dict]:
    """Build messages for LLM-based smart fill."""
    # Sample filled rows
    filled_samples = []
    for i, row in enumerate(data):
        val = row.get(field_name)
        if val is not None and str(val).strip() != "":
            filled_samples.append(f"  行{i + 1}: {val}")
        if len(filled_samples) >= max_sample:
            break

    sample_text = "\n".join(filled_samples) if filled_samples else "(无已填数据)"
    blank_text = ", ".join(str(i + 1) for i in blank_indices[:50])

    return [
        {
            "role": "system",
            "content": SMART_FILL_SYSTEM_PROMPT.format(
                field_name=field_name,
                field_alias=field_alias,
                data_type=data_type,
                sample_data=sample_text,
                blank_indices=blank_text,
            ),
        },
        {
            "role": "user",
            "content": f"请分析「{field_alias}」字段的数据规律，为空白行推荐填充值。",
        },
    ]


def parse_llm_smart_fill_response(content: str, blank_indices: list[int]) -> Optional[dict]:
    """Parse LLM response for smart fill."""
    content = content.strip()
    if content.startswith("```"):
        lines = content.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        content = "\n".join(lines)

    try:
        result = json.loads(content)
    except json.JSONDecodeError:
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            try:
                result = json.loads(json_match.group())
            except json.JSONDecodeError:
                return None
        else:
            return None

    return result
