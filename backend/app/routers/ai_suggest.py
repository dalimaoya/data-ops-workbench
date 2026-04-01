"""AI field suggestion API — POST /api/ai/field-suggest.

v4.0: Added simple-format endpoint and enhanced rules engine with enum suggestions.
"""

import time
import json
import re
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import TableConfig, FieldConfig, DatasourceConfig
from app.utils.auth import get_current_user, require_role
from app.utils.crypto import decrypt_password
from app.utils.remote_db import _connect
from app.ai.ai_engine import AIEngine
from app.ai.rules_engine import (
    suggest_semantic_name, is_system_field, is_readonly_field,
    suggest_enum, FIELD_NAME_MAP,
)
from app.i18n import t

router = APIRouter(prefix="/api/ai", tags=["AI Field Suggest"])


# ── Schemas ──

class FieldSuggestRequest(BaseModel):
    table_id: int
    sample_count: int = 100


class SimpleFieldInput(BaseModel):
    name: str
    type: str


class SimpleFieldSuggestRequest(BaseModel):
    datasource_id: Optional[int] = None
    table_name: Optional[str] = None
    fields: List[SimpleFieldInput]


class SimpleFieldSuggestion(BaseModel):
    field_name: str
    display_name: str
    is_readonly: bool
    is_system: bool
    suggested_enum: Optional[List[str]] = None


# ── Helpers ──

_NUMERIC_TYPE_PATTERNS = re.compile(
    r"(int|integer|bigint|smallint|tinyint|mediumint|serial|float|double|decimal|numeric|real|number)",
    re.IGNORECASE,
)

_AUTO_INC_PATTERNS = re.compile(
    r"(auto_increment|serial|nextval|identity)", re.IGNORECASE
)

_TIMESTAMP_PATTERNS = re.compile(
    r"(datetime|timestamp|date|time)", re.IGNORECASE
)


def _is_numeric_type(db_data_type: str) -> bool:
    return bool(_NUMERIC_TYPE_PATTERNS.search(db_data_type))


def _is_auto_increment(db_data_type: str, column_default: Optional[str] = None) -> bool:
    if _AUTO_INC_PATTERNS.search(db_data_type):
        return True
    if column_default and _AUTO_INC_PATTERNS.search(column_default):
        return True
    return False


def _sample_data_from_remote(ds: DatasourceConfig, tc: TableConfig, sample_count: int):
    """Connect to the remote business DB and sample data."""
    password = decrypt_password(ds.password_encrypted)
    conn = _connect(
        db_type=ds.db_type,
        host=ds.host,
        port=ds.port,
        user=ds.username,
        password=password,
        database=tc.db_name or ds.database_name,
        schema=tc.schema_name or ds.schema_name,
        charset=ds.charset or "utf8",
        timeout=ds.connect_timeout_seconds or 10,
    )
    try:
        cur = conn.cursor()
        table_name = tc.table_name
        db_type = ds.db_type

        # Build qualified name
        if db_type in ("postgresql", "kingbase"):
            sch = tc.schema_name or ds.schema_name or "public"
            qualified = f'"{sch}"."{table_name}"'
        elif db_type == "sqlserver":
            sch = tc.schema_name or ds.schema_name or "dbo"
            qualified = f"[{sch}].[{table_name}]"
        elif db_type == "sqlite":
            qualified = f"`{table_name}`"
        else:
            qualified = f"`{table_name}`"

        # Query with limit
        if db_type == "sqlserver":
            cur.execute(f"SELECT TOP {sample_count} * FROM {qualified}")
        elif db_type in ("oracle", "dm"):
            cur.execute(f"SELECT * FROM {qualified} WHERE ROWNUM <= {sample_count}")
        else:
            cur.execute(f"SELECT * FROM {qualified} LIMIT {sample_count}")

        columns = [desc[0] for desc in cur.description]
        rows = cur.fetchall()
        return columns, rows
    finally:
        conn.close()


def _analyze_column_values(col_idx: int, rows: list, is_numeric: bool):
    """Analyze sampled values for a single column."""
    values = []
    for row in rows:
        v = row[col_idx]
        if v is not None:
            values.append(v)

    result = {"total": len(rows), "non_null": len(values)}

    if not values:
        return result

    if is_numeric:
        # Try to compute min/max/avg for numeric columns
        nums = []
        for v in values:
            try:
                nums.append(float(v))
            except (ValueError, TypeError):
                pass
        if nums:
            result["min"] = min(nums)
            result["max"] = max(nums)
            result["avg"] = round(sum(nums) / len(nums), 2)
    else:
        # For non-numeric: compute unique values
        str_values = [str(v) for v in values]
        unique = list(dict.fromkeys(str_values))  # preserve order, dedup
        result["unique_count"] = len(unique)
        if len(unique) <= 20:
            # Sort by frequency
            freq = {}
            for sv in str_values:
                freq[sv] = freq.get(sv, 0) + 1
            sorted_vals = sorted(unique, key=lambda x: freq[x], reverse=True)
            result["enum_candidates"] = sorted_vals

    return result


def _build_llm_prompt(uncovered_fields: list, sample_info: dict) -> str:
    """Build a prompt for LLM to enhance field semantic names."""
    prompt = """你是一个数据库字段语义分析助手。请根据字段名、数据类型和样本数据，为以下字段推荐中文语义名。

要求：
1. 返回严格的 JSON 数组格式
2. 每个元素包含 field_name, display_name, reason
3. display_name 是简洁的中文名称（2-6个字）
4. reason 是推荐理由（一句话）

字段列表：
"""
    for f in uncovered_fields:
        info = sample_info.get(f["field_name"], {})
        sample_vals = ""
        if "enum_candidates" in info:
            sample_vals = f"，样本值: {info['enum_candidates'][:5]}"
        elif "min" in info:
            sample_vals = f"，范围: {info['min']}-{info['max']}"
        prompt += f"- {f['field_name']} (类型: {f['db_data_type']}{sample_vals})\n"

    prompt += "\n请返回 JSON 数组，不要输出其他内容："
    return prompt


# ── Endpoint ──

@router.post("/field-suggest")
async def field_suggest(
    body: FieldSuggestRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    """AI-powered field configuration suggestions."""
    start = time.time()

    # 1. Get table config & datasource
    tc = db.query(TableConfig).filter(
        TableConfig.id == body.table_id, TableConfig.is_deleted == 0
    ).first()
    if not tc:
        raise HTTPException(404, t("ai_suggest.table_not_found"))

    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == tc.datasource_id, DatasourceConfig.is_deleted == 0
    ).first()
    if not ds:
        raise HTTPException(404, t("ai_suggest.datasource_not_found"))

    # 2. Get field configs from platform DB
    fields = (
        db.query(FieldConfig)
        .filter(FieldConfig.table_config_id == tc.id, FieldConfig.is_deleted == 0)
        .order_by(FieldConfig.field_order_no)
        .all()
    )
    if not fields:
        raise HTTPException(400, t("ai_suggest.no_fields"))

    # 3. Sample data from remote business DB
    try:
        columns, rows = _sample_data_from_remote(ds, tc, body.sample_count)
    except Exception as e:
        raise HTTPException(500, t("ai_suggest.sample_failed", error=str(e)[:200]))

    actual_sample_count = len(rows)

    # Build column name → index map
    col_index = {c: i for i, c in enumerate(columns)}

    # 4. Analyze each field
    engine = AIEngine(db)
    suggestions = []
    uncovered_fields = []  # fields that rules engine can't handle

    for field in fields:
        fname = field.field_name
        ftype = field.db_data_type
        is_numeric = _is_numeric_type(ftype)

        # Analyze sample data for this column
        col_idx = col_index.get(fname)
        sample_analysis = {}
        if col_idx is not None:
            sample_analysis = _analyze_column_values(col_idx, rows, is_numeric)

        recommendations = []

        # 4a. Semantic name (display_name)
        semantic = suggest_semantic_name(fname)
        if semantic:
            recommendations.append({
                "property": "display_name",
                "value": semantic,
                "reason": f"字段名'{fname}'的常用中文释义",
                "confidence": 0.95,
            })
        else:
            # Mark as uncovered for LLM enhancement
            uncovered_fields.append({"field_name": fname, "db_data_type": ftype})

        # 4b. Readonly suggestion
        is_pk = bool(field.is_primary_key)
        auto_inc = _is_auto_increment(ftype)
        is_ro = is_readonly_field(fname)
        is_ts = bool(_TIMESTAMP_PATTERNS.search(ftype))

        if is_pk or auto_inc or is_ro:
            reason_parts = []
            if is_pk:
                reason_parts.append("主键字段")
            if auto_inc:
                reason_parts.append("自增字段")
            if is_ro and not is_pk:
                reason_parts.append("系统时间/审计字段")
            recommendations.append({
                "property": "is_readonly",
                "value": True,
                "reason": "、".join(reason_parts) + "不应由用户编辑",
                "confidence": 0.98 if is_pk else 0.92,
            })

        # 4c. System field suggestion
        if is_system_field(fname):
            recommendations.append({
                "property": "is_system_field",
                "value": True,
                "reason": f"字段名'{fname}'匹配系统字段模式",
                "confidence": 0.95,
            })

        # 4d. Enum values suggestion
        # Priority: sample data > rules engine
        if not is_numeric and "enum_candidates" in sample_analysis:
            candidates = sample_analysis["enum_candidates"]
            unique_count = sample_analysis.get("unique_count", len(candidates))
            recommendations.append({
                "property": "enum_values",
                "value": candidates,
                "reason": f"采样{actual_sample_count}条数据中发现{unique_count}个唯一值",
                "confidence": 0.85 if unique_count <= 10 else 0.70,
            })
        else:
            # Fallback: rules-based enum suggestion
            rule_enum = suggest_enum(fname)
            if rule_enum:
                recommendations.append({
                    "property": "enum_values",
                    "value": rule_enum,
                    "reason": f"字段名'{fname}'匹配常见枚举模式",
                    "confidence": 0.80,
                })

        # 4e. Numeric stats
        if is_numeric and "min" in sample_analysis:
            recommendations.append({
                "property": "value_range",
                "value": {
                    "min": sample_analysis["min"],
                    "max": sample_analysis["max"],
                    "avg": sample_analysis["avg"],
                },
                "reason": f"采样{actual_sample_count}条数据统计",
                "confidence": 0.90,
            })

        if recommendations:
            suggestions.append({
                "column_name": fname,
                "recommendations": recommendations,
            })

    # 5. LLM enhancement (if cloud mode and there are uncovered fields)
    engine_used = "builtin_rules"
    if uncovered_fields and engine.engine_mode == "cloud" and engine.is_feature_enabled("field_suggest"):
        client = engine.get_llm_client()
        if client:
            try:
                # Build sample info for prompt
                sample_info = {}
                for f in uncovered_fields:
                    idx = col_index.get(f["field_name"])
                    if idx is not None:
                        is_num = _is_numeric_type(f["db_data_type"])
                        sample_info[f["field_name"]] = _analyze_column_values(idx, rows, is_num)

                prompt = _build_llm_prompt(uncovered_fields, sample_info)
                resp = await client.chat([
                    {"role": "system", "content": "你是数据库字段语义分析助手。只返回JSON，不要其他文字。"},
                    {"role": "user", "content": prompt},
                ])
                content = resp.get("content", "").strip()

                # Parse LLM response — extract JSON array
                # Try to find JSON array in the response
                json_match = re.search(r'\[.*\]', content, re.DOTALL)
                if json_match:
                    llm_suggestions = json.loads(json_match.group())
                    for item in llm_suggestions:
                        fname = item.get("field_name", "")
                        display_name = item.get("display_name", "")
                        reason = item.get("reason", "AI语义推断")

                        if not fname or not display_name:
                            continue

                        # Find or create the suggestion entry
                        existing = next((s for s in suggestions if s["column_name"] == fname), None)
                        rec = {
                            "property": "display_name",
                            "value": display_name,
                            "reason": f"AI推荐：{reason}",
                            "confidence": 0.80,
                        }
                        if existing:
                            # Check if display_name already set by rules
                            has_dn = any(r["property"] == "display_name" for r in existing["recommendations"])
                            if not has_dn:
                                existing["recommendations"].insert(0, rec)
                        else:
                            suggestions.append({
                                "column_name": fname,
                                "recommendations": [rec],
                            })

                    engine_used = "builtin_rules+llm"
            except Exception:
                # LLM failed — gracefully degrade to rules only
                pass

    elapsed = int((time.time() - start) * 1000)

    return {
        "success": True,
        "data": {
            "field_count": len(fields),
            "sample_count": actual_sample_count,
            "suggestions": suggestions,
            "engine": engine_used,
            "elapsed_ms": elapsed,
        },
    }


# ── Simple-format endpoint (v4.0) ──
# Accepts raw field list (no DB lookup needed), returns flat suggestions.
# Rules engine only — fast, offline, no DB connection required.

@router.post("/field-suggest-simple")
async def field_suggest_simple(
    body: SimpleFieldSuggestRequest,
    current_user=Depends(require_role("admin")),
):
    """Lightweight AI field suggestion — rules engine only, no DB sampling.

    Accepts a list of {name, type} and returns display_name, is_readonly,
    is_system, and suggested_enum for each field.
    """
    start = time.time()
    suggestions: list[dict] = []

    for f in body.fields:
        fname = f.name
        ftype = f.type

        # Display name
        display_name = suggest_semantic_name(fname) or fname

        # Readonly / system
        ro = is_readonly_field(fname)
        sys_field = is_system_field(fname)

        # Enum suggestion: first try rules, then data-type heuristics
        enum_vals = suggest_enum(fname)

        suggestions.append({
            "field_name": fname,
            "display_name": display_name,
            "is_readonly": ro or sys_field,
            "is_system": sys_field,
            "suggested_enum": enum_vals,
        })

    elapsed = int((time.time() - start) * 1000)

    return {
        "success": True,
        "data": {
            "suggestions": suggestions,
            "engine": "builtin_rules",
            "elapsed_ms": elapsed,
        },
    }
