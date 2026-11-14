import "server-only";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { formatDateTime } from "@/lib/format";
import type { ReportData } from "./definitions";

/** Neutralise spreadsheet formula injection in exported text. */
function safeCell(v: string | number | null): string | number {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function renderCsv(r: ReportData): string {
  const data = r.rows.map((row) => Object.fromEntries(r.columns.map((c) => [c.label, safeCell(row[c.key] ?? null)])));
  return "﻿" + Papa.unparse({ fields: r.columns.map((c) => c.label), data: data.map((d) => r.columns.map((c) => d[c.label])) });
}

export async function renderXlsx(r: ReportData, company: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = company;
  wb.created = new Date();
  const ws = wb.addWorksheet(r.title.slice(0, 31));
  ws.addRow([r.title]).font = { bold: true, size: 14 };
  ws.addRow([r.subtitle]).font = { color: { argb: "FF555555" } };
  ws.addRow([`Generated ${formatDateTime(new Date())} (Asia/Colombo) · ${company}`]).font = { color: { argb: "FF888888" }, size: 9 };
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F2747" } };
  });
  r.rows.forEach((row, i) => {
    const added = ws.addRow(r.columns.map((c) => safeCell(row[c.key] ?? null)));
    if (r.rowTone?.[i] === "danger") added.font = { bold: true, color: { argb: "FFA52727" } };
  });
  r.columns.forEach((c, i) => (ws.getColumn(i + 1).width = c.width ?? Math.max(12, c.label.length + 2)));
  ws.views = [{ state: "frozen", ySplit: 5 }];
  if (r.notes?.length) {
    ws.addRow([]);
    r.notes.forEach((n) => (ws.addRow([n]).font = { italic: true, color: { argb: "FF666666" } }));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function renderPdf(r: ReportData, company: string): Buffer {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(r.title, 36, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(r.subtitle, 36, 56);
  doc.text(`${company} · Generated ${formatDateTime(new Date())} (Asia/Colombo) · ${r.rows.length} rows`, 36, 69);
  const ascii = (v: string | number | null) => (v === null || v === undefined ? "" : String(v).replace(/[^\x20-\x7E -ÿ]/g, ""));
  autoTable(doc, {
    startY: 82,
    head: [r.columns.map((c) => c.label)],
    body: r.rows.map((row) => r.columns.map((c) => ascii(row[c.key] ?? null))),
    styles: { fontSize: r.pdfFontSize ?? 7, cellPadding: (r.pdfFontSize ?? 7) < 7 ? 2 : 3, overflow: "linebreak" },
    headStyles: { fillColor: [15, 39, 71], textColor: 255, fontSize: r.pdfFontSize ?? 7 },
    alternateRowStyles: { fillColor: [246, 247, 249] },
    margin: { left: 36, right: 36 },
    didParseCell: (data) => {
      if (data.section === "body" && r.rowTone?.[data.row.index] === "danger") {
        data.cell.styles.textColor = [165, 39, 39];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });
  if (r.notes?.length) {
    const y = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 100;
    doc.setFontSize(8);
    doc.setTextColor(100);
    // Wrap each note and move down by its real height, so long notes never overlap.
    const pageBottom = doc.internal.pageSize.getHeight() - 30;
    let cursor = y + 18;
    for (const n of r.notes) {
      const lines = doc.splitTextToSize(n, 760) as string[];
      if (cursor + lines.length * 10 > pageBottom) {
        doc.addPage();
        cursor = 40;
      }
      doc.text(lines, 36, cursor);
      cursor += lines.length * 10 + 3;
    }
  }
  return Buffer.from(doc.output("arraybuffer"));
}
