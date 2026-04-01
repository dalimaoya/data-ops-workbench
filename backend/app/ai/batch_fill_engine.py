"""Batch fill engine — parse natural language modification rules and apply to data.

Supports both rules-based parsing (offline, no LLM needed) and LLM-enhanced parsing.
"""

import re
import json
from typing import Optional


# ── Rule pattern definitions ──

# Quotes helper (Chinese + English quotes)
_Q = r'[「」""\'"\u201c\u201d]'  # Any kind of quote
_OQ = f'(?:{_Q})?'  # Optional opening quote
_CQ = f'(?:{_Q})?'  # Optional closing quote

# Pattern: conditional assignment — "部门是华北区的，状态改为停用"
_COND_SET_PATTERNS = [
    # X是Y的，Z改为/改成W
    re.compile(
        r'(?:把)?(?:所有)?'
        + _OQ + r'(?P<cond_field>[^「」""\'"\u201c\u201d，,]+?)' + _CQ
        + r'(?:是|为|等于|=)\s*'
        + _OQ + r'(?P<cond_value>[^「」""\'"\u201c\u201d，,]+?)' + _CQ
        + r'的?(?:[，,]\s*)?'
        + r'(?:把)?' + _OQ + r'(?P<target_field>[^「」""\'"\u201c\u201d，,]+?)' + _CQ
        + r'(?:改为|改成|设为|设置为|变为|变成|更改为|修改为)\s*'
        + _OQ + r'(?P<new_value>[^「」""\'"\u201c\u201d]+?)' + _CQ + r'$'
    ),
    # X大于/小于/>=Y的，Z改为W
    re.compile(
        r'(?:把)?(?:所有)?'
        + _OQ + r'(?P<cond_field>[^「」""\'"\u201c\u201d，,]+?)' + _CQ
        + r'(?P<cond_op>大于|小于|不小于|不大于|>=|<=|>|<|≥|≤)\s*'
        + _OQ + r'(?P<cond_value>[^「」""\'"\u201c\u201d，,]+?)' + _CQ
        + r'的?(?:[，,]\s*)?'
        + r'(?:把)?' + _OQ + r'(?P<target_field>[^「」""\'"\u201c\u201d，,]+?)' + _CQ
        + r'(?:改为|改成|设为|设置为|标记为|变为)\s*'
        + _OQ + r'(?P<new_value>[^「」""\'"\u201c\u201d]+?)' + _CQ + r'$'
    ),
]

# Pattern: global assignment — "所有记录的备注改为'已处理'"
_GLOBAL_SET_PATTERNS = [
    re.compile(
        r'(?:把)?所有(?:记录的?)?(?:「|"|\')?(?P<target_field>.+?)(?:」|"|\')?'
        r'(?:改为|改成|设为|设置为|变为|变成|修改为|更改为|统一改为|统一设为)\s*(?:「|"|\')?(?P<new_value>.+?)(?:」|"|\')?$'
    ),
    re.compile(
        r'(?:把)?(?:「|"|\')?(?P<target_field>.+?)(?:」|"|\')?(?:全部|都)'
        r'(?:改为|改成|设为|设置为|变为|变成)\s*(?:「|"|\')?(?P<new_value>.+?)(?:」|"|\')?$'
    ),
]

# Pattern: find-replace — "把所有负责人中的'张三'换成'李四'"
_REPLACE_PATTERNS = [
    re.compile(
        r'(?:把)?(?:所有)?(?:「|"|\')?(?P<target_field>.+?)(?:」|"|\')?'
        r'(?:中的?|里的?|字段中的?)(?:「|"|\')?(?P<old_value>.+?)(?:」|"|\')?'
        r'(?:换成|替换为|替换成|改为|改成)\s*(?:「|"|\')?(?P<new_value>.+?)(?:」|"|\')?$'
    ),
]

# Pattern: clear — "清空所有备注字段"
_CLEAR_PATTERNS = [
    re.compile(
        r'清空(?:所有)?(?:的)?(?:「|"|\')?(?P<target_field>.+?)(?:」|"|\')?(?:字段|列)?$'
    ),
    re.compile(
        r'(?:把)?(?:所有)?(?:「|"|\')?(?P<target_field>.+?)(?:」|"|\')?(?:字段|列)?(?:清空|置空|设为空|改为空)$'
    ),
]

# Pattern: arithmetic — "所有金额增加10%"  "所有价格减少100"
_ARITH_PATTERNS = [
    re.compile(
        r'(?:把)?(?:所有)?(?:记录的?)?(?:「|"|\')?(?P<target_field>.+?)(?:」|"|\')?'
        r'(?:增加|加上|提高|上调)\s*(?P<value>[\d.]+)\s*(?P<unit>%|％)?$'
    ),
    re.compile(
        r'(?:把)?(?:所有)?(?:记录的?)?(?:「|"|\')?(?P<target_field>.+?)(?:」|"|\')?'
        r'(?:减少|减去|降低|下调)\s*(?P<value>[\d.]+)\s*(?P<unit>%|％)?$'
    ),
    re.compile(
        r'(?:把)?(?:所有)?(?:记录的?)?(?:「|"|\')?(?P<target_field>.+?)(?:」|"|\')?'
        r'(?:乘以|乘)\s*(?P<value>[\d.]+)$'
    ),
]

# Operator mapping for comparison conditions
_OP_MAP = {
    '大于': '>', '小于': '<', '不小于': '>=', '不大于': '<=',
    '>=': '>=', '<=': '<=', '>': '>', '<': '<', '≥': '>=', '≤': '<=',
}


def _match_field(field_text: str, field_map: dict[str, str]) -> Optional[str]:
    """Match user-provided field name/alias to actual field_name.
    
    field_map: {field_name: field_alias, ...} and reverse mapping.
    Returns field_name or None.
    """
    field_text = field_text.strip().strip('「」"\'')
    # Direct match by field_name
    if field_text in field_map:
        return field_map[field_text]
    # Case-insensitive
    lower_map = {k.lower(): v for k, v in field_map.items()}
    if field_text.lower() in lower_map:
        return lower_map[field_text.lower()]
    # Fuzzy: contains
    for k, v in field_map.items():
        if field_text in k or k in field_text:
            return v
    return None


def _build_field_map(fields: list[dict]) -> dict[str, str]:
    """Build bidirectional field alias -> field_name map.
    
    fields: [{"field_name": "dept", "field_alias": "部门"}, ...]
    Returns: {"dept": "dept", "部门": "dept", ...}
    """
    m: dict[str, str] = {}
    for f in fields:
        fn = f["field_name"]
        fa = f.get("field_alias") or fn
        m[fn] = fn
        m[fa] = fn
        # Also add lowercase
        m[fn.lower()] = fn
        m[fa.lower()] = fn
    return m


def parse_rule_text(rule_text: str, fields: list[dict]) -> Optional[dict]:
    """Parse a natural language modification rule into a structured rule dict.
    
    Returns dict with keys:
        rule_type: "conditional_set" | "global_set" | "replace" | "clear" | "arithmetic"
        condition: {...} or None
        target_field: str (field_name)
        action: {...}
    Or None if no pattern matches.
    """
    rule_text = rule_text.strip()
    field_map = _build_field_map(fields)

    # Try conditional set with comparison operators
    for pat in _COND_SET_PATTERNS[1:]:
        m = pat.match(rule_text)
        if m:
            groups = m.groupdict()
            cond_field = _match_field(groups.get("cond_field", ""), field_map)
            target_field = _match_field(groups.get("target_field", ""), field_map)
            if cond_field and target_field:
                op_text = groups.get("cond_op", "")
                return {
                    "rule_type": "conditional_set",
                    "condition": {
                        "field": cond_field,
                        "operator": _OP_MAP.get(op_text, "eq"),
                        "value": groups.get("cond_value", "").strip(),
                    },
                    "target_field": target_field,
                    "action": {"type": "set", "value": groups.get("new_value", "").strip()},
                }

    # Try conditional set with equality
    for pat in _COND_SET_PATTERNS[:1]:
        m = pat.match(rule_text)
        if m:
            groups = m.groupdict()
            cond_field = _match_field(groups.get("cond_field", ""), field_map)
            target_field = _match_field(groups.get("target_field", ""), field_map)
            if cond_field and target_field:
                return {
                    "rule_type": "conditional_set",
                    "condition": {
                        "field": cond_field,
                        "operator": "eq",
                        "value": groups.get("cond_value", "").strip(),
                    },
                    "target_field": target_field,
                    "action": {"type": "set", "value": groups.get("new_value", "").strip()},
                }

    # Try global set
    for pat in _GLOBAL_SET_PATTERNS:
        m = pat.match(rule_text)
        if m:
            groups = m.groupdict()
            target_field = _match_field(groups.get("target_field", ""), field_map)
            if target_field:
                return {
                    "rule_type": "global_set",
                    "condition": None,
                    "target_field": target_field,
                    "action": {"type": "set", "value": groups.get("new_value", "").strip()},
                }

    # Try replace
    for pat in _REPLACE_PATTERNS:
        m = pat.match(rule_text)
        if m:
            groups = m.groupdict()
            target_field = _match_field(groups.get("target_field", ""), field_map)
            if target_field:
                return {
                    "rule_type": "replace",
                    "condition": None,
                    "target_field": target_field,
                    "action": {
                        "type": "replace",
                        "old_value": groups.get("old_value", "").strip(),
                        "new_value": groups.get("new_value", "").strip(),
                    },
                }

    # Try clear
    for pat in _CLEAR_PATTERNS:
        m = pat.match(rule_text)
        if m:
            groups = m.groupdict()
            target_field = _match_field(groups.get("target_field", ""), field_map)
            if target_field:
                return {
                    "rule_type": "clear",
                    "condition": None,
                    "target_field": target_field,
                    "action": {"type": "clear"},
                }

    # Try arithmetic
    for i, pat in enumerate(_ARITH_PATTERNS):
        m = pat.match(rule_text)
        if m:
            groups = m.groupdict()
            target_field = _match_field(groups.get("target_field", ""), field_map)
            if target_field:
                value = float(groups.get("value", "0"))
                is_percent = groups.get("unit") in ("%", "％")
                if i == 0:  # increase
                    op = "multiply" if is_percent else "add"
                    arith_value = 1 + value / 100 if is_percent else value
                elif i == 1:  # decrease
                    op = "multiply" if is_percent else "subtract"
                    arith_value = 1 - value / 100 if is_percent else value
                else:  # multiply
                    op = "multiply"
                    arith_value = value
                return {
                    "rule_type": "arithmetic",
                    "condition": None,
                    "target_field": target_field,
                    "action": {"type": op, "value": arith_value},
                }

    return None


def apply_rule_to_data(
    rule: dict,
    data: list[dict],
    fields: list[dict],
    pk_fields: list[str],
) -> list[dict]:
    """Apply a parsed rule to data rows and return list of changes.
    
    Each change: {"row_index": int, "pk_value": str, "field": str, "field_alias": str, "old_value": str, "new_value": str}
    """
    changes: list[dict] = []
    target_field = rule.get("target_field", "")
    
    # Find field alias
    field_alias = target_field
    for f in fields:
        if f["field_name"] == target_field:
            field_alias = f.get("field_alias") or target_field
            break

    action = rule.get("action") or {}
    condition = rule.get("condition")

    for row_idx, row in enumerate(data):
        # Check condition
        if condition:
            cond_field = condition.get("field", "")
            cond_op = condition.get("operator", "")
            cond_value = condition.get("value", "")
            cell_value = row.get(cond_field)
            
            if cell_value is None:
                continue
                
            if cond_op == "eq":
                if str(cell_value).strip() != str(cond_value).strip():
                    continue
            elif cond_op in (">", ">=", "<", "<="):
                try:
                    cv = float(cell_value)
                    tv = float(cond_value)
                    if cond_op == ">" and not (cv > tv):
                        continue
                    elif cond_op == ">=" and not (cv >= tv):
                        continue
                    elif cond_op == "<" and not (cv < tv):
                        continue
                    elif cond_op == "<=" and not (cv <= tv):
                        continue
                except (ValueError, TypeError):
                    continue

        old_value = row.get(target_field)
        old_str = str(old_value) if old_value is not None else ""

        # Apply action
        action_type = action.get("type", "")
        if action_type == "set":
            new_value = action.get("value", "")
            if old_str == str(new_value):
                continue
        elif action_type == "replace":
            old_replace = action.get("old_value", "")
            new_replace = action.get("new_value", "")
            if not old_replace or old_replace not in old_str:
                continue
            new_value = old_str.replace(old_replace, new_replace)
            if old_str == new_value:
                continue
        elif action_type == "clear":
            if old_value is None or old_str == "":
                continue
            new_value = ""
        elif action_type == "add":
            try:
                num = float(old_str) if old_str else 0
                result = num + action.get("value", 0)
                new_value = _format_number(result, old_str)
            except (ValueError, TypeError):
                continue
        elif action_type == "subtract":
            try:
                num = float(old_str) if old_str else 0
                result = num - action.get("value", 0)
                new_value = _format_number(result, old_str)
            except (ValueError, TypeError):
                continue
        elif action_type == "multiply":
            try:
                num = float(old_str) if old_str else 0
                result = num * action.get("value", 0)
                new_value = _format_number(result, old_str)
            except (ValueError, TypeError):
                continue
        else:
            continue

        pk_value = "|".join(str(row.get(pk, "")) for pk in pk_fields)
        changes.append({
            "row_index": row_idx,
            "pk_value": pk_value,
            "field": target_field,
            "field_alias": field_alias,
            "old_value": old_str if old_value is not None else None,
            "new_value": str(new_value),
        })

    return changes


def _format_number(value: float, original_str: str) -> str:
    """Format a number preserving the original precision style."""
    if '.' in original_str:
        # Try to keep same decimal places
        decimal_places = len(original_str.split('.')[1]) if '.' in original_str else 0
        return f"{value:.{decimal_places}f}"
    else:
        # Integer style
        if value == int(value):
            return str(int(value))
        return f"{value:.2f}"


def build_explanation(rule: dict, fields: list[dict]) -> str:
    """Build a human-readable explanation of the parsed rule."""
    target_alias = rule.get("target_field", "未知字段")
    for f in fields:
        if f["field_name"] == rule.get("target_field"):
            target_alias = f.get("field_alias") or rule.get("target_field", "未知字段")
            break

    action = rule.get("action") or {}
    condition = rule.get("condition")

    parts = []
    if condition:
        cond_alias = condition.get("field", "未知字段")
        for f in fields:
            if f["field_name"] == condition.get("field"):
                cond_alias = f.get("field_alias") or condition.get("field", "未知字段")
                break
        cond_op = condition.get("operator", "")
        op_text = {"eq": "等于", ">": "大于", ">=": "不小于", "<": "小于", "<=": "不大于"}.get(
            cond_op, cond_op
        )
        parts.append(f"筛选【{cond_alias}】{op_text}'{condition.get('value', '')}'的记录")

    action_type = action.get("type", "")
    if action_type == "set":
        parts.append(f"将【{target_alias}】修改为'{action.get('value', '')}'")
    elif action_type == "replace":
        parts.append(f"将【{target_alias}】中的'{action.get('old_value', '')}'替换为'{action.get('new_value', '')}'")
    elif action_type == "clear":
        parts.append(f"清空【{target_alias}】字段")
    elif action_type == "add":
        parts.append(f"将【{target_alias}】增加 {action.get('value', 0)}")
    elif action_type == "subtract":
        parts.append(f"将【{target_alias}】减少 {action.get('value', 0)}")
    elif action_type == "multiply":
        parts.append(f"将【{target_alias}】乘以 {action.get('value', 0)}")
    else:
        parts.append("规则不适用于此表")

    return "，".join(parts) if parts else "规则不适用于此表"


# ── LLM-enhanced parsing ──

BATCH_FILL_SYSTEM_PROMPT = """你是一个数据修改规则解析助手。用户会用自然语言描述批量修改数据的规则，你需要解析为结构化 JSON。

可用字段列表：
{fields_context}

输出严格 JSON 格式（不要包含 markdown 代码块标记）：
{{
  "rule_type": "conditional_set" | "global_set" | "replace" | "clear" | "arithmetic",
  "condition": {{
    "field": "实际字段名(field_name)",
    "operator": "eq" | ">" | ">=" | "<" | "<=" | "contains" | "starts_with",
    "value": "条件值"
  }} 或 null,
  "target_field": "实际字段名(field_name)",
  "action": {{
    "type": "set" | "replace" | "clear" | "add" | "subtract" | "multiply",
    "value": "新值或数值",
    "old_value": "仅replace时的旧值"
  }}
}}

注意：
1. field 必须使用字段列表中的 field_name（英文名），不是别名
2. 不支持"删除记录"操作，如果用户要求删除，返回 {{"error": "不支持删除记录操作"}}
3. 如果无法理解规则，返回 {{"error": "无法解析规则: 具体原因"}}
"""


def build_llm_prompt(rule_text: str, fields: list[dict]) -> list[dict]:
    """Build messages for LLM-based rule parsing."""
    fields_ctx = "\n".join(
        f"- {f['field_name']} ({f.get('field_alias', f['field_name'])}): {f.get('db_data_type', 'text')}"
        for f in fields
    )
    return [
        {
            "role": "system",
            "content": BATCH_FILL_SYSTEM_PROMPT.format(fields_context=fields_ctx),
        },
        {
            "role": "user",
            "content": f"请解析以下修改规则：\n{rule_text}",
        },
    ]


def parse_llm_response(content: str) -> Optional[dict]:
    """Parse LLM response JSON into a rule dict."""
    # Strip markdown code block if present
    content = content.strip()
    if content.startswith("```"):
        lines = content.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        content = "\n".join(lines)

    try:
        result = json.loads(content)
    except json.JSONDecodeError:
        # Try to extract JSON from the text
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            try:
                result = json.loads(json_match.group())
            except json.JSONDecodeError:
                return None
        else:
            return None

    if "error" in result:
        return result

    # Validate required fields
    if not result.get("rule_type") or not result.get("target_field") or not result.get("action"):
        return None

    # Validate action completeness — LLM may return incomplete actions for non-matching tables
    action = result.get("action", {})
    action_type = action.get("type", "")
    if action_type == "replace":
        if "old_value" not in action or "new_value" not in action:
            return {"error": "规则不适用于此表（替换操作缺少必要参数）"}
    elif action_type in ("set", "add", "subtract", "multiply"):
        if "value" not in action:
            return {"error": "规则不适用于此表（操作缺少目标值）"}
    elif action_type not in ("clear",):
        return {"error": f"不支持的操作类型: {action_type}"}

    return result
