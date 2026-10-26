"""CSV / JSON / PDF export built from the filtered database query.

Privacy handling
----------------
Reporter identities are excluded unless ``include_reporter`` is requested and
the caller is an admin. File-system paths are never included; only relative
media URLs inside the API.
"""
from __future__ import annotations

import csv
import io
import json
from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Any

from app.models.entities import DamageReport
from app.services.serializers import thumbnail_url

CSV_COLUMNS = [
    "reference",
    "status",
    "damage_category",
    "ai_suggested_category",
    "detection_confidence",
    "reviewed_severity",
    "road_importance",
    "priority_score",
    "latitude",
    "longitude",
    "location_source",
    "road_name",
    "ward",
    "is_verified",
    "is_synthetic",
    "detection_count",
    "reported_at",
    "resolved_at",
    "resolution_days",
    "description",
]


def _row(report: DamageReport, *, include_reporter: bool = False) -> dict[str, Any]:
    resolution_days = None
    if report.resolved_at and report.reported_at and report.resolved_at >= report.reported_at:
        resolution_days = round((report.resolved_at - report.reported_at).total_seconds() / 86400, 2)
    row = {
        "reference": report.reference,
        "status": report.status,
        "damage_category": report.damage_category,
        "ai_suggested_category": report.ai_suggested_category,
        "detection_confidence": report.detection_confidence,
        "reviewed_severity": report.reviewed_severity,
        "road_importance": report.road_importance,
        "priority_score": round(report.priority_score or 0.0, 2),
        "latitude": report.latitude,
        "longitude": report.longitude,
        "location_source": report.location_source,
        "road_name": report.road_name,
        "ward": report.ward,
        "is_verified": report.is_verified,
        "is_synthetic": report.is_synthetic,
        "detection_count": len(report.detections),
        "reported_at": report.reported_at.isoformat() if report.reported_at else None,
        "resolved_at": report.resolved_at.isoformat() if report.resolved_at else None,
        "resolution_days": resolution_days,
        "description": report.description,
    }
    if include_reporter:
        row["reporter_label"] = report.reporter_label
    return row


def to_csv(reports: Sequence[DamageReport], *, include_reporter: bool = False) -> str:
    buffer = io.StringIO()
    columns = CSV_COLUMNS + (["reporter_label"] if include_reporter else [])
    writer = csv.DictWriter(buffer, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for report in reports:
        writer.writerow(_row(report, include_reporter=include_reporter))
    return buffer.getvalue()


def to_json(
    reports: Sequence[DamageReport],
    *,
    include_reporter: bool = False,
    filters: dict[str, Any] | None = None,
) -> str:
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "record_count": len(reports),
        "filters": filters or {},
        "notice": (
            "Records flagged is_synthetic=true come from the demo data generator and are not real reports."
        ),
        "reports": [
            {
                **_row(report, include_reporter=include_reporter),
                "id": report.id,
                "thumbnail_url": thumbnail_url(report),
                "detections": [
                    {
                        "class_label": d.class_label,
                        "confidence": d.confidence,
                        "bbox": {"x1": d.bbox_x1, "y1": d.bbox_y1, "x2": d.bbox_x2, "y2": d.bbox_y2},
                        "model_version": d.model_version,
                    }
                    for d in report.detections
                ],
                "history": [
                    {
                        "from": u.previous_status,
                        "to": u.new_status,
                        "notes": u.notes,
                        "actor": u.actor_label,
                        "at": u.created_at.isoformat(),
                    }
                    for u in report.repair_updates
                ],
            }
            for report in reports
        ],
    }
    return json.dumps(payload, indent=2, default=str)


def to_pdf(
    *,
    reports: Sequence[DamageReport],
    kpis: list[dict[str, Any]],
    category_counts: list[dict[str, Any]],
    status_counts: list[dict[str, Any]],
    severity_counts: list[dict[str, Any]],
    by_date: list[dict[str, Any]],
    filters: dict[str, Any] | None = None,
    title: str = "RoadGuard AI — Road Damage Summary",
) -> bytes:
    """Render a printable PDF summary (KPI table, distributions, bar charts)."""
    from reportlab.graphics.shapes import Drawing, Rect, String
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        PageBreak,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=title,
    )
    styles = getSampleStyleSheet()
    heading = ParagraphStyle("Heading", parent=styles["Heading1"], fontSize=18, spaceAfter=6, textColor=colors.HexColor("#0F172A"))
    sub = ParagraphStyle("Sub", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#475569"))
    section = ParagraphStyle("Section", parent=styles["Heading2"], fontSize=12, spaceBefore=10, spaceAfter=6, textColor=colors.HexColor("#0F172A"))

    story: list = [
        Paragraph(title, heading),
        Paragraph(
            f"Generated at {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} · "
            f"{len(reports)} record(s) · RoadGuard AI",
            sub,
        ),
        Paragraph(
            "Figures are computed from stored database records. Records flagged DEMO come from the "
            "synthetic demo generator and are not real citizen submissions.",
            sub,
        ),
        Spacer(1, 8),
    ]
    if filters:
        applied = ", ".join(f"{k}={v}" for k, v in filters.items() if v not in (None, "", [], False))
        story.append(Paragraph(f"Filters: {applied or 'none'}", sub))

    story.append(Paragraph("Key indicators", section))
    kpi_rows = [["Indicator", "Value"]]
    for card in kpis:
        value = card.get("value", 0)
        if isinstance(value, float):
            value = f"{value:,.2f}"
        suffix = f" {card['unit']}" if card.get("unit") else ""
        kpi_rows.append([card["label"], f"{value}{suffix}"])
    kpi_table = Table(kpi_rows, colWidths=[95 * mm, 45 * mm])
    kpi_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E293B")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F1F5F9")]),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ]
        )
    )
    story.append(kpi_table)

    def bar_chart(title_text: str, data: list[dict[str, Any]], colour: str) -> Drawing:
        width, height = 170 * mm, 52 * mm
        drawing = Drawing(width, height)
        drawing.add(String(0, height - 10, title_text, fontName="Helvetica-Bold", fontSize=9, fillColor=colors.HexColor("#1E293B")))
        if not data:
            drawing.add(String(4, height / 2, "No data for this filter", fontSize=8, fillColor=colors.HexColor("#64748B")))
            return drawing
        values = [float(item.get("value") or 0) for item in data]
        top = max(values) or 1
        bar_area = width - 10
        step = bar_area / max(len(data), 1)
        bar_width = max(3.0, step * 0.62)
        for index, item in enumerate(data):
            value = float(item.get("value") or 0)
            bar_height = (value / top) * (height - 26)
            x = 4 + index * step
            drawing.add(
                Rect(
                    x,
                    14,
                    bar_width,
                    max(bar_height, 0.5),
                    fillColor=colors.HexColor(colour),
                    strokeColor=None,
                )
            )
            if len(data) <= 14:
                drawing.add(
                    String(
                        x,
                        4,
                        str(item.get("label", ""))[:14],
                        fontSize=5.5,
                        fillColor=colors.HexColor("#475569"),
                    )
                )
        return drawing

    story.append(Paragraph("Distributions", section))
    story.append(bar_chart("Reports by category", category_counts, "#EA580C"))
    story.append(Spacer(1, 4))
    story.append(bar_chart("Reports by status", status_counts, "#0F172A"))
    story.append(Spacer(1, 4))
    story.append(bar_chart("Severity distribution", severity_counts, "#DC2626"))
    story.append(Spacer(1, 4))
    story.append(bar_chart("Reports by date (last 30 days)", by_date, "#0EA5E9"))

    story.append(PageBreak())
    story.append(Paragraph("Report register", section))
    table_rows = [["Reference", "Status", "Category", "Severity", "Priority", "Conf.", "Reported"]]
    for report in reports[:120]:
        table_rows.append(
            [
                report.reference,
                report.status.replace("_", " "),
                report.damage_category.replace("_", " ")[:18],
                report.reviewed_severity or "—",
                f"{report.priority_score:.0f}",
                f"{report.detection_confidence:.2f}" if report.detection_confidence else "—",
                report.reported_at.strftime("%Y-%m-%d") if report.reported_at else "—",
            ]
        )
    if len(reports) > 120:
        table_rows.append(["…", f"{len(reports) - 120} more rows omitted", "", "", "", "", ""])
    table = Table(table_rows, colWidths=[34 * mm, 30 * mm, 32 * mm, 18 * mm, 16 * mm, 14 * mm, 22 * mm], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E293B")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 7.5),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F1F5F9")]),
                ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD5E1")),
            ]
        )
    )
    story.append(table)

    doc.build(story)
    return buffer.getvalue()
