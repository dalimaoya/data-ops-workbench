"""Audit Report Export — PDF 审计报告导出"""

import io
import os
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel

from app.database import get_db
from app.models import SystemOperationLog, UserAccount
from app.utils.auth import get_current_user, require_role

router = APIRouter(prefix="/api/audit", tags=["audit-export"])

_BJT = timezone(timedelta(hours=8))


class TimeRange(BaseModel):
    start: str
    end: str


class AuditExportRequest(BaseModel):
    time_range: TimeRange
    format: str = "pdf"
    include: List[str] = ["operations", "writebacks", "field_changes", "logins"]


@router.post("/export-report")
def export_audit_report(
    body: AuditExportRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role("admin")),
):
    """Generate and download an audit PDF report."""
    try:
        start_dt = datetime.strptime(body.time_range.start, "%Y-%m-%d")
        end_dt = datetime.strptime(body.time_range.end, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
    except ValueError:
        raise HTTPException(400, "日期格式错误，请使用 YYYY-MM-DD")

    # Query operation logs
    logs = db.query(SystemOperationLog).filter(
        SystemOperationLog.created_at >= start_dt,
        SystemOperationLog.created_at <= end_dt,
    ).order_by(SystemOperationLog.created_at.desc()).all()

    # Categorize
    operations = []
    writebacks = []
    logins = []
    field_changes = []

    for log in logs:
        entry = {
            "time": log.created_at.strftime("%Y-%m-%d %H:%M:%S") if log.created_at else "",
            "user": log.operator_user or "",
            "type": log.operation_type or "",
            "module": log.operation_module or "",
            "status": log.operation_status or "",
            "message": (log.operation_message or "")[:100],
        }
        if log.operation_type in ("登录", "login"):
            logins.append(entry)
        elif log.operation_type in ("回写", "writeback", "inline_update", "inline_insert", "inline_delete"):
            writebacks.append(entry)
        else:
            operations.append(entry)

    # Build PDF
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    # Register Chinese font
    font_paths = [
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttc",
        "/usr/share/fonts/chinese/TrueType/wqy-zenhei.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    ]
    cn_font = "Helvetica"
    for fp in font_paths:
        if os.path.isfile(fp):
            try:
                pdfmetrics.registerFont(TTFont("CNFont", fp))
                cn_font = "CNFont"
                break
            except Exception:
                continue

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
                            topMargin=20 * mm, bottomMargin=20 * mm)

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("TitleCN", parent=styles["Title"], fontName=cn_font, fontSize=18)
    heading_style = ParagraphStyle("HeadingCN", parent=styles["Heading2"], fontName=cn_font, fontSize=14)
    normal_style = ParagraphStyle("NormalCN", parent=styles["Normal"], fontName=cn_font, fontSize=9)

    elements = []

    # Cover
    elements.append(Spacer(1, 80 * mm))
    elements.append(Paragraph("数据运维工作台", title_style))
    elements.append(Spacer(1, 10 * mm))
    elements.append(Paragraph("审计报告", title_style))
    elements.append(Spacer(1, 15 * mm))
    elements.append(Paragraph(f"报告期间：{body.time_range.start} ~ {body.time_range.end}", normal_style))
    elements.append(Paragraph(f"生成时间：{datetime.now(_BJT).strftime('%Y-%m-%d %H:%M:%S')}", normal_style))
    elements.append(Paragraph(f"生成人：{user.username}", normal_style))
    elements.append(PageBreak())

    # Summary
    elements.append(Paragraph("操作统计摘要", heading_style))
    elements.append(Spacer(1, 5 * mm))
    summary_data = [
        ["统计项", "数量"],
        ["总操作记录", str(len(logs))],
        ["一般操作", str(len(operations))],
        ["回写变更", str(len(writebacks))],
        ["登录记录", str(len(logins))],
    ]
    st = Table(summary_data, colWidths=[80 * mm, 50 * mm])
    st.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#4472C4")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), cn_font),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ALIGN", (1, 0), (1, -1), "CENTER"),
    ]))
    elements.append(st)
    elements.append(Spacer(1, 10 * mm))

    def _make_table(title: str, data_list: list, include_key: str):
        if include_key not in body.include:
            return
        elements.append(Paragraph(title, heading_style))
        elements.append(Spacer(1, 5 * mm))
        if not data_list:
            elements.append(Paragraph("无记录", normal_style))
            elements.append(Spacer(1, 5 * mm))
            return
        header = ["时间", "操作人", "类型", "模块", "状态", "内容"]
        rows = [header]
        for item in data_list[:500]:  # Limit
            rows.append([
                item["time"], item["user"], item["type"],
                item["module"], item["status"], item["message"][:40],
            ])
        t = Table(rows, colWidths=[30 * mm, 20 * mm, 20 * mm, 25 * mm, 15 * mm, 50 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#4472C4")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, -1), cn_font),
            ("FONTSIZE", (0, 0), (-1, -1), 7),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("WORDWRAP", (0, 0), (-1, -1), True),
        ]))
        elements.append(t)
        elements.append(Spacer(1, 10 * mm))

    _make_table("详细操作记录", operations, "operations")
    _make_table("回写变更明细", writebacks, "writebacks")
    _make_table("登录记录", logins, "logins")

    doc.build(elements)
    buf.seek(0)

    filename = f"audit_report_{body.time_range.start}_{body.time_range.end}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
