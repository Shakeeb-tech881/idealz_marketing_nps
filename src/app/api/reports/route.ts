import { NextResponse, type NextRequest } from "next/server";
import { AuthorisationError, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseFilters } from "@/lib/analytics/filters";
import { getSettings } from "@/lib/settings";
import { REPORT_TYPES, type ReportFormat, type ReportType } from "@/server/reports/definitions";
import { buildReport } from "@/server/reports/build";
import { renderCsv, renderPdf, renderXlsx } from "@/server/reports/render";

export async function GET(req: NextRequest) {
  try {
    // Staff have no access to system-wide reports.
    const actor = await requireRole(["super_admin", "management", "branch_manager"]);
    const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
    const type = sp.type as ReportType;
    const format = sp.format as ReportFormat;
    if (!REPORT_TYPES.some((r) => r.value === type)) return NextResponse.json({ error: "Unknown report type" }, { status: 400 });
    if (!["csv", "xlsx", "pdf"].includes(format)) return NextResponse.json({ error: "Unknown format" }, { status: 400 });

    const supabase = await createClient();
    // `type` is the report type here; the customer-type filter arrives as `survey`.
    const filters = parseFilters({ ...sp, type: sp.survey }, "30d");
    const settings = await getSettings(supabase);
    let branchName: string | null = null;
    if (filters.branch) {
      const { data } = await supabase.from("branches").select("name").eq("id", filters.branch).maybeSingle();
      branchName = data?.name ?? null;
    } else if (actor.role === "branch_manager" && actor.branch_id) {
      const { data } = await supabase.from("branches").select("name").eq("id", actor.branch_id).maybeSingle();
      branchName = data?.name ?? null;
    }
    const report = await buildReport(supabase, actor, type, filters, branchName, settings.min_employee_sample, sp);
    await supabase.rpc("log_audit", {
      p_action: "report.exported",
      p_entity_type: "report",
      p_entity_id: type,
      p_details: { format, rows: report.rows.length, from: filters.from, to: filters.to, branch: filters.branch },
    });

    const base = `idealz-${type.replace(/_/g, "-")}-${filters.from}-to-${filters.to}`;
    const headers = (ct: string, ext: string) => ({
      "Content-Type": ct,
      "Content-Disposition": `attachment; filename="${base}.${ext}"`,
      "Cache-Control": "no-store",
    });
    if (format === "csv") return new NextResponse(renderCsv(report), { headers: headers("text/csv; charset=utf-8", "csv") });
    if (format === "xlsx") {
      const buf = await renderXlsx(report, settings.company_name);
      return new NextResponse(new Uint8Array(buf), { headers: headers("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx") });
    }
    return new NextResponse(new Uint8Array(renderPdf(report, settings.company_name)), { headers: headers("application/pdf", "pdf") });
  } catch (e) {
    if (e instanceof AuthorisationError) return NextResponse.json({ error: e.message }, { status: 403 });
    console.error("[reports]", e);
    return NextResponse.json({ error: "Report could not be generated." }, { status: 500 });
  }
}
