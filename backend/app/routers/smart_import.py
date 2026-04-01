"""Smart Import Center API — file parsing, table matching, field mapping, template CRUD."""

import json
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import MappingTemplate, TableConfig, FieldConfig
from app.utils.auth import get_current_user
from app.ai.file_parser import parse_file
from app.ai.smart_import_engine import match_tables, map_fields, _normalize_text, _jaccard_similarity
from app.i18n import t

router = APIRouter(prefix="/api/ai/import", tags=["Smart Import"])

_BJT = timezone(timedelta(hours=8))


# ── Schemas ──

class TableDataItem(BaseModel):
    table_index: int
    source_location: Optional[str] = None
    title_guess: Optional[str] = None
    row_count: int = 0
    col_count: int = 0
    headers: List[str] = []
    preview_rows: List[List[str]] = []
    all_rows: List[List[str]] = []
    parseable: bool = True


class MatchTablesRequest(BaseModel):
    tables: List[TableDataItem]
    use_ai: bool = False


class MapFieldsRequest(BaseModel):
    source_headers: List[str]
    target_table_id: int
    use_ai: bool = False


class MappingTemplateCreate(BaseModel):
    template_name: str
    target_table_id: int
    mappings: List[Dict[str, Any]]
    source_headers: List[str] = []


class MappingTemplateUpdate(BaseModel):
    template_name: Optional[str] = None
    mappings: Optional[List[Dict[str, Any]]] = None


# ── 1. Parse File ──

@router.post("/parse-file")
async def parse_file_endpoint(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    """Upload and parse a file to extract table data."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    # Validate file size (max 50MB)
    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 50MB)")

    # Validate extension
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ("xlsx", "xls", "docx", "pdf", "csv"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: .{ext}. Supported: xlsx, docx, pdf, csv",
        )

    try:
        result = parse_file(content, file.filename)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to parse file: {str(e)}")

    # Remove all_rows from response (too large for API response, keep only preview)
    for tbl in result.get("tables", []):
        tbl.pop("all_rows", None)

    return {"success": True, "data": result}


# ── 2. Match Tables ──

@router.post("/match-tables")
def match_tables_endpoint(
    req: MatchTablesRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Match extracted tables to managed tables."""
    tables_data = [t.model_dump() for t in req.tables]
    results = match_tables(tables_data, db, use_ai=req.use_ai)
    return {"success": True, "data": results}


# ── 3. Map Fields ──

@router.post("/map-fields")
def map_fields_endpoint(
    req: MapFieldsRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Map source columns to target table fields."""
    # Check target table exists
    table_cfg = db.query(TableConfig).filter(
        TableConfig.id == req.target_table_id,
        TableConfig.is_deleted == 0,
    ).first()
    if not table_cfg:
        raise HTTPException(status_code=404, detail="Target table not found")

    mappings = map_fields(req.source_headers, req.target_table_id, db, use_ai=req.use_ai)

    # Also check for matching templates
    template_match = _find_matching_template(req.source_headers, req.target_table_id, db)

    return {
        "success": True,
        "data": {
            "mappings": mappings,
            "matched_template": template_match,
        },
    }


# ── 4. Mapping Template CRUD ──

@router.get("/mapping-templates")
def list_mapping_templates(
    target_table_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """List all mapping templates."""
    q = db.query(MappingTemplate).filter(MappingTemplate.is_deleted == 0)
    if target_table_id is not None:
        q = q.filter(MappingTemplate.target_table_id == target_table_id)
    templates = q.order_by(MappingTemplate.updated_at.desc()).all()

    result = []
    for t in templates:
        result.append({
            "id": t.id,
            "template_name": t.template_name,
            "target_table_id": t.target_table_id,
            "mappings": json.loads(t.mappings_json) if t.mappings_json else [],
            "source_headers": json.loads(t.source_headers_json) if t.source_headers_json else [],
            "use_count": t.use_count,
            "last_used_at": t.last_used_at.isoformat() if t.last_used_at else None,
            "created_by": t.created_by,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "updated_at": t.updated_at.isoformat() if t.updated_at else None,
        })

    return {"success": True, "data": result}


@router.post("/mapping-templates")
def create_mapping_template(
    req: MappingTemplateCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Create a new mapping template."""
    username = current_user.get("username", "system") if isinstance(current_user, dict) else getattr(current_user, "username", "system")

    template = MappingTemplate(
        template_name=req.template_name,
        target_table_id=req.target_table_id,
        mappings_json=json.dumps(req.mappings, ensure_ascii=False),
        source_headers_json=json.dumps(req.source_headers, ensure_ascii=False),
        created_by=username,
        updated_by=username,
    )
    db.add(template)
    db.commit()
    db.refresh(template)

    return {"success": True, "data": {"id": template.id}}


@router.put("/mapping-templates/{template_id}")
def update_mapping_template(
    template_id: int,
    req: MappingTemplateUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Update an existing mapping template."""
    template = db.query(MappingTemplate).filter(
        MappingTemplate.id == template_id,
        MappingTemplate.is_deleted == 0,
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    username = current_user.get("username", "system") if isinstance(current_user, dict) else getattr(current_user, "username", "system")

    if req.template_name is not None:
        template.template_name = req.template_name
    if req.mappings is not None:
        template.mappings_json = json.dumps(req.mappings, ensure_ascii=False)
    template.updated_by = username

    db.commit()
    return {"success": True}


@router.delete("/mapping-templates/{template_id}")
def delete_mapping_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Soft-delete a mapping template."""
    template = db.query(MappingTemplate).filter(
        MappingTemplate.id == template_id,
        MappingTemplate.is_deleted == 0,
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    template.is_deleted = 1
    db.commit()
    return {"success": True}


# ── Template Matching Helper ──

def _find_matching_template(
    source_headers: List[str],
    target_table_id: int,
    db: Session,
) -> Optional[Dict[str, Any]]:
    """Find best matching template for given source headers."""
    templates = db.query(MappingTemplate).filter(
        MappingTemplate.target_table_id == target_table_id,
        MappingTemplate.is_deleted == 0,
    ).all()

    if not templates:
        return None

    source_set = set(_normalize_text(h) for h in source_headers if h.strip())
    best_template = None
    best_similarity = 0.0

    for t in templates:
        try:
            stored_headers = json.loads(t.source_headers_json) if t.source_headers_json else []
        except Exception:
            continue

        stored_set = set(_normalize_text(h) for h in stored_headers if h.strip())
        sim = _jaccard_similarity(source_set, stored_set)

        if sim > best_similarity and sim > 0.7:
            best_similarity = sim
            best_template = t

    if not best_template:
        return None

    return {
        "template_id": best_template.id,
        "template_name": best_template.template_name,
        "similarity": round(best_similarity, 2),
        "mappings": json.loads(best_template.mappings_json) if best_template.mappings_json else [],
    }
