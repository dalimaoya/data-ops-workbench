"""Smart Import Engine — table matching, field mapping, template management."""

import re
import json
from typing import List, Dict, Any, Optional, Tuple
from sqlalchemy.orm import Session

from app.models import TableConfig, FieldConfig
from app.ai.ai_engine import AIEngine


# ── Built-in synonym table for government/enterprise statistics ──

SYNONYM_TABLE: Dict[str, List[str]] = {
    "GDP": ["地区生产总值", "国内生产总值", "生产总值", "gdp", "GDP", "地区GDP"],
    "人口": ["总人口", "常住人口", "户籍人口", "population", "人口数"],
    "增长率": ["增速", "增长%", "同比增长", "增幅", "growth_rate", "增长率"],
    "财政收入": ["一般公共预算收入", "公共财政收入", "fiscal_revenue", "财政收入"],
    "固定资产投资": ["固投", "投资额", "fixed_investment", "固定资产投资"],
    "社会消费品零售总额": ["社零", "消费品零售", "retail_sales", "社零总额"],
    "城镇居民人均可支配收入": ["城镇人均收入", "城镇可支配收入", "urban_income"],
    "单位": ["计量单位", "unit", "度量单位"],
    "年份": ["年度", "时期", "year", "period", "年"],
    "第一产业": ["第一产业增加值", "primary_industry", "一产"],
    "第二产业": ["第二产业增加值", "secondary_industry", "二产"],
    "第三产业": ["第三产业增加值", "tertiary_industry", "三产"],
    "工业增加值": ["规上工业增加值", "industrial_value_added", "工业"],
    "进出口总额": ["外贸总额", "进出口", "import_export"],
    "居民消费价格指数": ["CPI", "cpi", "消费价格指数"],
    "城镇化率": ["城镇化水平", "urbanization_rate"],
    "失业率": ["城镇登记失业率", "unemployment_rate"],
    "人均GDP": ["人均生产总值", "per_capita_gdp", "人均地区生产总值"],
}


def _normalize_text(text: str) -> str:
    """Normalize text for comparison: lowercase, strip whitespace, remove parentheses content."""
    text = text.strip().lower()
    text = re.sub(r'[（(][^）)]*[）)]', '', text)  # Remove parenthesized content
    text = re.sub(r'\s+', '', text)
    return text


def _jaccard_similarity(set1: set, set2: set) -> float:
    if not set1 or not set2:
        return 0.0
    intersection = set1 & set2
    union = set1 | set2
    return len(intersection) / len(union) if union else 0.0


# ── Table Matching ──

def match_tables(
    extracted_tables: List[Dict[str, Any]],
    db: Session,
    use_ai: bool = False,
) -> List[Dict[str, Any]]:
    """Match extracted tables to managed tables (table_config).

    Returns list of match results, each with:
      - table_index, source_title, candidates: [{table_config_id, table_name, table_alias, confidence, match_reason}]
    """
    # Load all managed tables with their fields
    managed_tables = db.query(TableConfig).filter(
        TableConfig.is_deleted == 0,
        TableConfig.status == "enabled",
    ).all()

    managed_info = []
    for mt in managed_tables:
        fields = db.query(FieldConfig).filter(
            FieldConfig.table_config_id == mt.id,
            FieldConfig.is_deleted == 0,
        ).all()
        field_names = set()
        field_aliases = set()
        for f in fields:
            field_names.add(f.field_name.lower())
            if f.field_alias:
                field_aliases.add(_normalize_text(f.field_alias))
                # Also expand synonyms
                for syn_group in SYNONYM_TABLE.values():
                    norm_syns = [_normalize_text(s) for s in syn_group]
                    if _normalize_text(f.field_alias) in norm_syns:
                        field_aliases.update(norm_syns)

        managed_info.append({
            "id": mt.id,
            "table_name": mt.table_name,
            "table_alias": mt.table_alias or mt.table_name,
            "table_comment": mt.table_comment or "",
            "field_names": field_names,
            "field_aliases": field_aliases,
        })

    results = []
    for tbl in extracted_tables:
        if not tbl.get("parseable", True):
            results.append({
                "table_index": tbl["table_index"],
                "source_title": tbl.get("title_guess"),
                "candidates": [],
                "parseable": False,
            })
            continue

        source_title = tbl.get("title_guess", "") or ""
        source_headers = set(_normalize_text(h) for h in tbl.get("headers", []) if h.strip())

        # Expand source headers with synonyms
        expanded_headers = set(source_headers)
        for h in source_headers:
            for syn_group in SYNONYM_TABLE.values():
                norm_syns = [_normalize_text(s) for s in syn_group]
                if h in norm_syns:
                    expanded_headers.update(norm_syns)

        candidates = []
        for mi in managed_info:
            score = 0.0
            reasons = []

            # Title matching
            if source_title:
                norm_title = _normalize_text(source_title)
                norm_alias = _normalize_text(mi["table_alias"])
                norm_comment = _normalize_text(mi["table_comment"])

                if norm_alias and (norm_alias in norm_title or norm_title in norm_alias):
                    score += 0.4
                    reasons.append("标题匹配")
                elif norm_comment and (norm_comment in norm_title or norm_title in norm_comment):
                    score += 0.3
                    reasons.append("注释匹配")

            # Column name matching (Jaccard)
            all_target_names = mi["field_names"] | mi["field_aliases"]
            jaccard = _jaccard_similarity(expanded_headers, all_target_names)
            if jaccard > 0:
                score += jaccard * 0.6
                reasons.append(f"列名匹配(Jaccard={jaccard:.2f})")

            if score > 0.1:
                candidates.append({
                    "table_config_id": mi["id"],
                    "table_name": mi["table_name"],
                    "table_alias": mi["table_alias"],
                    "confidence": round(min(score, 1.0), 2),
                    "match_reason": " + ".join(reasons),
                })

        # Sort by confidence desc
        candidates.sort(key=lambda c: c["confidence"], reverse=True)

        results.append({
            "table_index": tbl["table_index"],
            "source_title": source_title or None,
            "candidates": candidates[:5],
        })

    # Optional: AI enhancement
    if use_ai:
        try:
            engine = AIEngine(db)
            if engine.is_enabled and engine.engine_mode != "builtin":
                results = _ai_enhance_matching(results, extracted_tables, managed_info, engine)
        except Exception:
            pass  # Graceful degradation

    return results


def _ai_enhance_matching(
    results: List[Dict],
    extracted_tables: List[Dict],
    managed_info: List[Dict],
    engine: AIEngine,
) -> List[Dict]:
    """Use LLM to improve matching for low-confidence results."""
    client = engine.get_llm_client()
    if not client:
        return results

    for i, result in enumerate(results):
        if result.get("parseable") is False:
            continue
        # Only enhance if top candidate confidence < 0.7
        top_conf = result["candidates"][0]["confidence"] if result["candidates"] else 0
        if top_conf >= 0.7:
            continue

        tbl = extracted_tables[i]
        managed_names = [f"{mi['table_alias']}({mi['table_name']})" for mi in managed_info]

        prompt = (
            f"以下是从文件中提取的一个表格：\n"
            f"标题：{tbl.get('title_guess', '无')}\n"
            f"列名：{', '.join(tbl.get('headers', []))}\n"
            f"样本数据：{tbl.get('preview_rows', [])[:2]}\n\n"
            f"以下是系统中的纳管表列表：\n{chr(10).join(managed_names)}\n\n"
            f"请判断这个表格最可能对应哪个纳管表？只返回表名，如果都不匹配返回'无'。"
        )

        try:
            resp = client.chat(prompt)
            if resp and resp.strip() != "无":
                for mi in managed_info:
                    if mi["table_alias"] in resp or mi["table_name"] in resp:
                        # Check if already in candidates
                        existing = [c for c in result["candidates"] if c["table_config_id"] == mi["id"]]
                        if existing:
                            existing[0]["confidence"] = max(existing[0]["confidence"], 0.75)
                            existing[0]["match_reason"] += " + AI推荐"
                        else:
                            result["candidates"].insert(0, {
                                "table_config_id": mi["id"],
                                "table_name": mi["table_name"],
                                "table_alias": mi["table_alias"],
                                "confidence": 0.75,
                                "match_reason": "AI语义匹配",
                            })
                        break
                result["candidates"].sort(key=lambda c: c["confidence"], reverse=True)
        except Exception:
            pass

    return results


# ── Field Mapping ──

def map_fields(
    source_headers: List[str],
    target_table_id: int,
    db: Session,
    use_ai: bool = False,
) -> List[Dict[str, Any]]:
    """Map source columns to target table fields using 3-tier matching.

    Returns list of mappings:
      {source_column, target_field, target_alias, confidence, match_type, candidates}
    """
    fields = db.query(FieldConfig).filter(
        FieldConfig.table_config_id == target_table_id,
        FieldConfig.is_deleted == 0,
    ).order_by(FieldConfig.field_order_no).all()

    target_fields = []
    for f in fields:
        target_fields.append({
            "field_name": f.field_name,
            "field_alias": f.field_alias or f.field_name,
            "db_data_type": f.db_data_type,
            "is_required": f.is_required,
            "include_in_import": f.include_in_import,
        })

    mappings = []
    used_targets = set()

    for src_col in source_headers:
        norm_src = _normalize_text(src_col)
        best_match = None
        best_confidence = 0.0
        best_type = "unmatched"
        all_candidates = []

        for tf in target_fields:
            if tf["field_name"] in used_targets:
                continue

            norm_name = _normalize_text(tf["field_name"])
            norm_alias = _normalize_text(tf["field_alias"])

            # Layer 1: Exact match
            if norm_src == norm_name or norm_src == norm_alias:
                conf = 1.0
                mtype = "exact"
            # Layer 2: Fuzzy match
            else:
                conf, mtype = _fuzzy_match(norm_src, norm_name, norm_alias, tf["field_alias"])

            if conf > 0.3:
                all_candidates.append({
                    "field_name": tf["field_name"],
                    "field_alias": tf["field_alias"],
                    "confidence": round(conf, 2),
                    "match_type": mtype,
                })

            if conf > best_confidence:
                best_confidence = conf
                best_match = tf
                best_type = mtype

        # Sort candidates
        all_candidates.sort(key=lambda c: c["confidence"], reverse=True)

        mapping = {
            "source_column": src_col,
            "target_field": best_match["field_name"] if best_match and best_confidence > 0.3 else None,
            "target_alias": best_match["field_alias"] if best_match and best_confidence > 0.3 else None,
            "confidence": round(best_confidence, 2) if best_confidence > 0.3 else 0,
            "match_type": best_type,
            "candidates": all_candidates[:5],
        }
        mappings.append(mapping)

        if best_match and best_confidence > 0.5:
            used_targets.add(best_match["field_name"])

    # Layer 3: AI semantic matching for unmatched fields
    if use_ai:
        try:
            engine = AIEngine(db)
            if engine.is_enabled and engine.engine_mode != "builtin":
                mappings = _ai_enhance_mapping(mappings, target_fields, engine)
        except Exception:
            pass

    return mappings


def _fuzzy_match(
    norm_src: str, norm_field: str, norm_alias: str, raw_alias: str
) -> Tuple[float, str]:
    """Layer 2: Fuzzy matching with synonyms and containment."""
    best_conf = 0.0
    best_type = "unmatched"

    # Containment check
    if norm_alias and (norm_alias in norm_src or norm_src in norm_alias):
        conf = 0.75
        if conf > best_conf:
            best_conf = conf
            best_type = "fuzzy"

    if norm_field and (norm_field in norm_src or norm_src in norm_field):
        conf = 0.65
        if conf > best_conf:
            best_conf = conf
            best_type = "fuzzy"

    # Synonym matching
    for canonical, synonyms in SYNONYM_TABLE.items():
        norm_syns = [_normalize_text(s) for s in synonyms]
        norm_canonical = _normalize_text(canonical)

        src_match = (norm_src in norm_syns or norm_src == norm_canonical or
                     any(s in norm_src for s in norm_syns))
        target_match = (norm_alias in norm_syns or norm_alias == norm_canonical or
                       norm_field in norm_syns or norm_field == norm_canonical or
                       any(s in norm_alias for s in norm_syns))

        if src_match and target_match:
            conf = 0.85
            if conf > best_conf:
                best_conf = conf
                best_type = "synonym"
            break

    return best_conf, best_type


def _ai_enhance_mapping(
    mappings: List[Dict],
    target_fields: List[Dict],
    engine: AIEngine,
) -> List[Dict]:
    """Use LLM to fill in unmatched fields."""
    client = engine.get_llm_client()
    if not client:
        return mappings

    unmatched = [m for m in mappings if m["confidence"] < 0.5]
    if not unmatched:
        return mappings

    target_info = [f"{f['field_name']}({f['field_alias']})" for f in target_fields]

    prompt = (
        f"以下是需要映射的源列名和目标字段列表。\n\n"
        f"源列名（未匹配）：\n"
        + "\n".join(f"- {m['source_column']}" for m in unmatched)
        + f"\n\n目标字段列表：\n"
        + "\n".join(f"- {t}" for t in target_info)
        + "\n\n请为每个源列名推荐最可能对应的目标字段。"
        f"返回JSON数组格式：[{{\"source\": \"...\", \"target\": \"...\", \"confidence\": 0.8}}]"
        f"\n如果确实无法匹配，confidence设为0。"
    )

    try:
        resp = client.chat(prompt)
        # Try to parse JSON from response
        json_match = re.search(r'\[.*\]', resp, re.DOTALL)
        if json_match:
            ai_mappings = json.loads(json_match.group())
            for aim in ai_mappings:
                src = aim.get("source", "")
                tgt = aim.get("target", "")
                conf = float(aim.get("confidence", 0))
                if conf < 0.5:
                    continue

                # Find and update the mapping
                for m in mappings:
                    if m["source_column"] == src and m["confidence"] < conf:
                        # Find target field info
                        for tf in target_fields:
                            if tf["field_name"] == tgt or tgt in tf["field_name"]:
                                m["target_field"] = tf["field_name"]
                                m["target_alias"] = tf["field_alias"]
                                m["confidence"] = round(conf, 2)
                                m["match_type"] = "ai"
                                break
                        break
    except Exception:
        pass

    return mappings
