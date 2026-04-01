"""Natural Language Query Engine — converts Chinese natural language to structured filters.

Two modes:
  1. Built-in rules (no LLM required): keyword matching, negation, date ranges, numeric comparisons
  2. LLM-enhanced: sends query + field context to LLM for complex understanding
"""

import re
import json
from datetime import datetime, timedelta, timezone
from typing import Optional

_BJT = timezone(timedelta(hours=8))


def _today_bjt() -> datetime:
    return datetime.now(_BJT)


# ── Operator display mapping ──
_OP_DISPLAY = {
    "eq": "=",
    "neq": "≠",
    "gt": ">",
    "gte": "≥",
    "lt": "<",
    "lte": "≤",
    "like": "包含",
    "not_like": "不包含",
    "is_null": "为空",
    "is_not_null": "不为空",
    "in": "在",
    "not_in": "不在",
    "between": "介于",
}


def _make_filter(field: str, display_name: str, operator: str, value, raw_match: str = "") -> dict:
    """Build a standardized filter dict."""
    op_sym = _OP_DISPLAY.get(operator, operator)
    if operator in ("is_null", "is_not_null"):
        display = f"{display_name} {op_sym}"
    elif operator == "between" and isinstance(value, list) and len(value) == 2:
        display = f"{display_name} {value[0]} ~ {value[1]}"
    else:
        display = f"{display_name} {op_sym} {value}"
    return {
        "field": field,
        "operator": operator,
        "value": value,
        "display": display,
    }


# ═══════════════════════════════════════════
# 1. Rule-based NL parser
# ═══════════════════════════════════════════

# ── Date patterns ──
_DATE_PATTERNS = [
    # 最近X天
    (r"最近\s*(\d+)\s*天", "recent_days"),
    # 最近X个月
    (r"最近\s*(\d+)\s*个月", "recent_months"),
    # 今天/今日
    (r"今[天日]", "today"),
    # 昨天/昨日
    (r"昨[天日]", "yesterday"),
    # 本周
    (r"本周", "this_week"),
    # 本月
    (r"本月", "this_month"),
    # 本年/今年
    (r"[本今]年", "this_year"),
    # 上个月/上月
    (r"上个?月", "last_month"),
    # 前天
    (r"前天", "day_before_yesterday"),
]

# ── Negation patterns ──
_NEGATION_PATTERNS = [
    r"不是\s*",
    r"不等于\s*",
    r"不为\s*",
    r"排除\s*",
    r"非\s*",
    r"除了\s*",
    r"不包[含括]\s*",
]

# ── Comparison patterns ──
_COMPARISON_PATTERNS = [
    (r"大于等于\s*([\d.]+)", "gte"),
    (r"小于等于\s*([\d.]+)", "lte"),
    (r"不大于\s*([\d.]+)", "lte"),
    (r"不小于\s*([\d.]+)", "gte"),
    (r"大于\s*([\d.]+)", "gt"),
    (r"超过\s*([\d.]+)", "gt"),
    (r"高于\s*([\d.]+)", "gt"),
    (r"多于\s*([\d.]+)", "gt"),
    (r"小于\s*([\d.]+)", "lt"),
    (r"低于\s*([\d.]+)", "lt"),
    (r"少于\s*([\d.]+)", "lt"),
    (r"不超过\s*([\d.]+)", "lte"),
    (r"等于\s*([\d.]+)", "eq"),
]

# ── Null patterns ──
_NULL_PATTERNS = [
    (r"(.+?)为空", "is_null"),
    (r"(.+?)不为空", "is_not_null"),
    (r"(.+?)是空的", "is_null"),
    (r"(.+?)没有值", "is_null"),
    (r"(.+?)有值", "is_not_null"),
]

# ── Field name fuzzy matching keywords ──
_FIELD_KEYWORDS = {
    "更新": ["update_time", "updated_at", "gmt_modified", "modify_time"],
    "修改": ["update_time", "updated_at", "gmt_modified", "modify_time"],
    "创建": ["create_time", "created_at", "gmt_create"],
    "新增": ["create_time", "created_at", "gmt_create"],
    "添加": ["create_time", "created_at", "gmt_create"],
    "状态": ["status", "state"],
    "名称": ["name", "title"],
    "名字": ["name", "user_name", "username"],
    "类型": ["type", "category"],
    "部门": ["department", "dept", "org"],
    "金额": ["amount", "price", "cost", "money"],
    "数量": ["quantity", "count", "num"],
    "备注": ["remark", "note", "memo", "comment"],
    "地址": ["address", "addr"],
    "手机": ["phone", "mobile", "tel"],
    "邮箱": ["email", "mail"],
    "编号": ["id", "code", "no", "number"],
    "值班": ["duty", "on_duty", "shift"],
    "日期": ["date", "time"],
    "时间": ["time", "date"],
}


def _resolve_date_range(pattern_type: str, number: int = 0) -> tuple[str, str]:
    """Returns (start_date_str, end_date_str) in ISO format."""
    today = _today_bjt().replace(hour=0, minute=0, second=0, microsecond=0)
    end = today + timedelta(days=1)  # end of today

    if pattern_type == "recent_days":
        start = today - timedelta(days=number)
    elif pattern_type == "recent_months":
        month = today.month - number
        year = today.year
        while month <= 0:
            month += 12
            year -= 1
        start = today.replace(year=year, month=month, day=1)
    elif pattern_type == "today":
        start = today
    elif pattern_type == "yesterday":
        start = today - timedelta(days=1)
        end = today
    elif pattern_type == "day_before_yesterday":
        start = today - timedelta(days=2)
        end = today - timedelta(days=1)
    elif pattern_type == "this_week":
        start = today - timedelta(days=today.weekday())
    elif pattern_type == "this_month":
        start = today.replace(day=1)
    elif pattern_type == "this_year":
        start = today.replace(month=1, day=1)
    elif pattern_type == "last_month":
        first_of_month = today.replace(day=1)
        last_month_end = first_of_month - timedelta(days=1)
        start = last_month_end.replace(day=1)
        end = first_of_month
    else:
        start = today - timedelta(days=7)

    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def _find_best_field(keyword: str, fields: list[dict]) -> Optional[dict]:
    """Find the best matching field for a keyword from the available fields list."""
    # Direct match on display_name or field name
    for f in fields:
        dn = (f.get("display_name") or "").lower()
        fn = f.get("name", "").lower()
        if keyword == dn or keyword == fn:
            return f

    # Fuzzy match using keyword map
    candidates = _FIELD_KEYWORDS.get(keyword, [])
    for cand in candidates:
        for f in fields:
            if f.get("name", "").lower() == cand:
                return f

    # Partial match on display_name
    for f in fields:
        dn = f.get("display_name") or ""
        if keyword in dn or dn in keyword:
            return f

    # Partial match on field name
    for f in fields:
        fn = f.get("name", "")
        if keyword in fn or fn in keyword:
            return f

    return None


def _find_date_field(fields: list[dict], hint_keywords: list[str] = None) -> Optional[dict]:
    """Find the best date/time field based on hints."""
    date_types = {"datetime", "timestamp", "date", "time"}

    # If hint keywords given, try them first
    if hint_keywords:
        for kw in hint_keywords:
            f = _find_best_field(kw, fields)
            if f:
                dtype = (f.get("type") or "").lower()
                if any(dt in dtype for dt in date_types):
                    return f

    # Fallback: find any time field, preferring update_time > create_time
    time_fields = []
    for f in fields:
        dtype = (f.get("type") or "").lower()
        if any(dt in dtype for dt in date_types):
            time_fields.append(f)

    if not time_fields:
        return None

    # Prefer update_time, then create_time, then first
    for prefer in ["update_time", "updated_at", "gmt_modified", "create_time", "created_at"]:
        for f in time_fields:
            if f.get("name") == prefer:
                return f

    return time_fields[0]


def _find_enum_match(query_text: str, fields: list[dict]) -> list[dict]:
    """Match enum values mentioned in query against field enum_values."""
    filters = []
    for f in fields:
        enum_vals = f.get("enum_values") or []
        if not enum_vals:
            continue
        for ev in enum_vals:
            if ev in query_text:
                # Check if there's a negation before this value
                negated = False
                idx = query_text.find(ev)
                prefix = query_text[:idx]
                for neg_pat in _NEGATION_PATTERNS:
                    if re.search(neg_pat + r"$", prefix) or re.search(neg_pat + re.escape(ev), query_text):
                        negated = True
                        break

                dn = f.get("display_name") or f.get("name", "")
                op = "neq" if negated else "eq"
                filters.append(_make_filter(f["name"], dn, op, ev))
    return filters


def parse_nl_query_rules(query_text: str, fields: list[dict], previous_filters: list[dict] = None) -> dict:
    """
    Parse a Chinese natural language query into structured filters using rules.

    Args:
        query_text: User's natural language query
        fields: List of field dicts with keys: name, display_name, type, enum_values
        previous_filters: Existing filters for follow-up queries

    Returns:
        dict with keys: filters, explanation, confidence, engine
    """
    text = query_text.strip()
    filters: list[dict] = []
    if previous_filters:
        filters.extend(previous_filters)

    matched_parts = []

    # 1. Date range patterns
    for pattern, ptype in _DATE_PATTERNS:
        m = re.search(pattern, text)
        if m:
            number = int(m.group(1)) if m.lastindex and m.lastindex >= 1 else 0
            start_date, end_date = _resolve_date_range(ptype, number)

            # Determine which date field based on context
            hint_keywords = []
            context_before = text[:m.start()]
            if any(kw in context_before for kw in ["更新", "修改"]):
                hint_keywords = ["更新", "修改"]
            elif any(kw in context_before for kw in ["创建", "新增", "添加"]):
                hint_keywords = ["创建", "新增"]

            date_field = _find_date_field(fields, hint_keywords)
            if date_field:
                dn = date_field.get("display_name") or date_field.get("name", "")
                if ptype in ("today", "yesterday", "day_before_yesterday"):
                    # Single day: use gte + lt for precision
                    filters.append(_make_filter(date_field["name"], dn, "gte", start_date))
                    filters.append(_make_filter(date_field["name"], dn, "lt", end_date))
                else:
                    filters.append(_make_filter(date_field["name"], dn, "gte", start_date))
                matched_parts.append(m.group(0))

    # 2. Negation + value patterns: "不是X" / "不等于X" / "排除X"
    for neg_pat in _NEGATION_PATTERNS:
        # Match negation followed by a quoted or short value (stop at punctuation/particles)
        full_pat = neg_pat + r"[「」'\"']?([\u4e00-\u9fa5a-zA-Z0-9_]+?)[「」'\"']?(?=[的、，,。\s]|$)"
        for m in re.finditer(full_pat, text):
            val = m.group(1)
            # Try to find which field this value belongs to
            matched_field = None
            for f in fields:
                enum_vals = f.get("enum_values") or []
                if val in enum_vals:
                    matched_field = f
                    break
            if not matched_field:
                # Try to find field mentioned before the negation
                prefix = text[:m.start()].strip()
                for f in fields:
                    dn = f.get("display_name") or ""
                    fn = f.get("name", "")
                    if dn and dn in prefix[-len(dn) - 5:]:
                        matched_field = f
                        break
                    if fn in prefix[-len(fn) - 5:]:
                        matched_field = f
                        break

            if matched_field:
                dn = matched_field.get("display_name") or matched_field.get("name", "")
                # Check not already added by enum match
                already = any(
                    fl["field"] == matched_field["name"] and fl["value"] == val
                    for fl in filters
                )
                if not already:
                    filters.append(_make_filter(matched_field["name"], dn, "neq", val))
                    matched_parts.append(m.group(0))

    # 3. Numeric comparisons: "大于100" etc.
    for comp_pat, op in _COMPARISON_PATTERNS:
        for m in re.finditer(comp_pat, text):
            num_val = m.group(1)
            # Find numeric field from context before the match
            prefix = text[:m.start()].strip()
            target_field = None

            # Try to identify the field from words before the number
            for f in fields:
                dn = f.get("display_name") or ""
                fn = f.get("name", "")
                if dn and dn in prefix:
                    target_field = f
                    break

            if not target_field:
                # Try keyword matching on the prefix
                for kw in _FIELD_KEYWORDS:
                    if kw in prefix:
                        target_field = _find_best_field(kw, fields)
                        if target_field:
                            break

            if not target_field:
                # Default to any numeric field
                for f in fields:
                    dtype = (f.get("type") or "").lower()
                    if any(dt in dtype for dt in ("int", "decimal", "numeric", "float", "double", "number")):
                        target_field = f
                        break

            if target_field:
                dn = target_field.get("display_name") or target_field.get("name", "")
                # Convert to proper number type
                try:
                    if "." in num_val:
                        parsed_val = float(num_val)
                    else:
                        parsed_val = int(num_val)
                except ValueError:
                    parsed_val = num_val
                filters.append(_make_filter(target_field["name"], dn, op, parsed_val))
                matched_parts.append(m.group(0))

    # 4. Enum value matching (handles both positive and negative via _find_enum_match)
    enum_filters = _find_enum_match(text, fields)
    for ef in enum_filters:
        # Check not already present
        already = any(
            fl["field"] == ef["field"] and fl["value"] == ef["value"] and fl["operator"] == ef["operator"]
            for fl in filters
        )
        if not already:
            filters.append(ef)

    # 5. Null checks
    for null_pat, null_op in _NULL_PATTERNS:
        m = re.search(null_pat, text)
        if m:
            field_hint = m.group(1).strip()
            target_field = _find_best_field(field_hint, fields)
            if target_field:
                dn = target_field.get("display_name") or target_field.get("name", "")
                filters.append(_make_filter(target_field["name"], dn, null_op, None))
                matched_parts.append(m.group(0))

    # 6. "只看X" / "仅X" patterns — field value equality
    for m in re.finditer(r"(?:只看|仅|仅看|只要)\s*(.+?)(?:的|$)", text):
        val_hint = m.group(1).strip()
        # Try matching as enum value
        for f in fields:
            enum_vals = f.get("enum_values") or []
            for ev in enum_vals:
                if ev in val_hint or val_hint in ev:
                    dn = f.get("display_name") or f.get("name", "")
                    already = any(fl["field"] == f["name"] and fl["value"] == ev for fl in filters)
                    if not already:
                        filters.append(_make_filter(f["name"], dn, "eq", ev))

    # Deduplicate filters
    seen = set()
    unique_filters = []
    for fl in filters:
        key = (fl["field"], fl["operator"], str(fl["value"]))
        if key not in seen:
            seen.add(key)
            unique_filters.append(fl)

    # Build explanation
    if unique_filters:
        conditions = [f["display"] for f in unique_filters]
        explanation = "筛选出" + "、".join(conditions) + "的记录"
    else:
        explanation = "未能理解查询意图，请换个方式描述"

    # Confidence based on how much of the query we matched
    if not unique_filters:
        confidence = 0.0
    elif len(matched_parts) >= 2:
        confidence = 0.9
    elif len(unique_filters) >= 2:
        confidence = 0.85
    elif len(unique_filters) == 1:
        confidence = 0.75
    else:
        confidence = 0.5

    return {
        "filters": unique_filters,
        "explanation": explanation,
        "confidence": round(confidence, 2),
        "engine": "builtin_rules",
    }


# ═══════════════════════════════════════════
# 2. LLM-enhanced NL parser
# ═══════════════════════════════════════════

_LLM_SYSTEM_PROMPT = """你是一个数据查询助手。用户会用自然语言描述想查的数据条件，你需要将其转换为结构化的筛选条件 JSON。

可用的操作符：
- eq: 等于
- neq: 不等于
- gt: 大于
- gte: 大于等于
- lt: 小于
- lte: 小于等于
- like: 包含（模糊匹配）
- not_like: 不包含
- is_null: 为空
- is_not_null: 不为空
- in: 在列表中
- not_in: 不在列表中
- between: 在范围内（value 为 [start, end] 数组）

日期值使用 YYYY-MM-DD 格式。数值不加引号。

你必须只返回一个 JSON 对象，格式如下（不要附加任何其他文字）：
{
  "filters": [
    {"field": "字段名", "operator": "操作符", "value": "值", "display": "人话描述"}
  ],
  "explanation": "整体查询意图的人话总结",
  "confidence": 0.0到1.0的置信度
}"""


def _build_llm_user_prompt(query_text: str, fields: list[dict], previous_filters: list[dict] = None) -> str:
    """Build the user prompt for the LLM."""
    today_str = _today_bjt().strftime("%Y-%m-%d")

    field_desc = []
    for f in fields:
        desc = f"- {f.get('name')} ({f.get('display_name', '')}): 类型 {f.get('type', 'unknown')}"
        if f.get("enum_values"):
            desc += f", 可选值: {', '.join(f['enum_values'])}"
        field_desc.append(desc)

    prompt = f"""今天日期：{today_str}

可用字段：
{chr(10).join(field_desc)}

"""
    if previous_filters:
        prompt += f"已有筛选条件（用户在此基础上追问）：\n{json.dumps(previous_filters, ensure_ascii=False)}\n\n"

    prompt += f"用户查询：{query_text}\n\n请返回 JSON："

    return prompt


async def parse_nl_query_llm(query_text: str, fields: list[dict],
                              previous_filters: list[dict], ai_client) -> dict:
    """Use LLM to parse natural language query into filters."""
    messages = [
        {"role": "system", "content": _LLM_SYSTEM_PROMPT},
        {"role": "user", "content": _build_llm_user_prompt(query_text, fields, previous_filters)},
    ]

    try:
        resp = await ai_client.chat(messages, temperature=0.1, max_tokens=2000)
        content = resp.get("content", "").strip()

        # Try to extract JSON from response
        # Handle cases where LLM wraps in ```json ... ```
        json_match = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", content)
        if json_match:
            content = json_match.group(1)
        elif not content.startswith("{"):
            # Try to find first { ... }
            brace_match = re.search(r"\{[\s\S]*\}", content)
            if brace_match:
                content = brace_match.group(0)

        result = json.loads(content)

        # Validate structure
        if "filters" not in result:
            raise ValueError("Missing 'filters' key")

        filters = result.get("filters", [])
        # Validate each filter has required keys
        valid_filters = []
        for f in filters:
            if "field" in f and "operator" in f:
                # Ensure display field exists
                if "display" not in f:
                    field_info = next((fi for fi in fields if fi["name"] == f["field"]), None)
                    dn = (field_info.get("display_name") if field_info else None) or f["field"]
                    op_sym = _OP_DISPLAY.get(f["operator"], f["operator"])
                    f["display"] = f"{dn} {op_sym} {f.get('value', '')}"
                valid_filters.append(f)

        # Merge with previous filters if this is a follow-up
        if previous_filters:
            prev_keys = {(pf["field"], pf["operator"]) for pf in previous_filters}
            for pf in previous_filters:
                key = (pf["field"], pf["operator"])
                if not any((vf["field"], vf["operator"]) == key for vf in valid_filters):
                    valid_filters.insert(0, pf)

        return {
            "filters": valid_filters,
            "explanation": result.get("explanation", ""),
            "confidence": min(1.0, max(0.0, result.get("confidence", 0.8))),
            "engine": "llm",
        }

    except (json.JSONDecodeError, ValueError, KeyError) as e:
        # Fallback to rules engine
        return parse_nl_query_rules(query_text, fields, previous_filters)
    except Exception as e:
        # Network/timeout errors — fallback to rules
        fallback = parse_nl_query_rules(query_text, fields, previous_filters)
        fallback["engine"] = "builtin_rules (llm_fallback)"
        return fallback
