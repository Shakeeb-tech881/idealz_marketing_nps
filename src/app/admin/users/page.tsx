import type { Metadata } from "next";
import { requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { ROLE_LABELS, type Profile } from "@/lib/types";
import { getLookups } from "@/server/services/lookups";
import { PageHeader } from "@/components/admin/page-header";
import { Panel } from "@/components/admin/panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserDialog } from "./user-dialog";

export const metadata: Metadata = { title: "Users & roles" };

const ROLE_HELP = [
  { role: "Super Admin", text: "Full access: users, branches, employees, settings, integrations and all reports." },
  { role: "Management", text: "All branch analytics, NPS reports and feedback; manages follow-ups and SMS templates; exports reports." },
  { role: "Branch Manager", text: "Own branch only: performance, employees, feedback review and follow-up assignment." },
  { role: "Staff", text: "Only customer and feedback records they created or that are linked to their employee record. No system-wide analytics." },
];

export default async function UsersPage() {
  const me = await requirePageRole(["super_admin"]);
  const supabase = await createClient();
  const [{ data }, lookups] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, role, branch_id, employee_id, is_active, created_at").order("is_active", { ascending: false }).order("full_name"),
    getLookups(supabase, { includeInactive: true }),
  ]);
  const users = (data ?? []) as (Profile & { created_at: string })[];
  const branchName = new Map(lookups.branches.map((b) => [b.id, b.name]));
  const empName = new Map(lookups.employees.map((e) => [e.id, e.full_name]));

  return (
    <>
      <PageHeader title="Users & roles" description="Invite team members and control what they can access. Permissions are enforced by the database, not just hidden in the interface." actions={<UserDialog branches={lookups.branches} employees={lookups.employees} />} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
        <Panel bodyClassName="px-0 pb-0" className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="pl-5">User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Linked employee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="pr-5 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="pl-5">
                      <p className="font-medium">{u.full_name || "—"}{u.id === me.id && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </TableCell>
                    <TableCell>{ROLE_LABELS[u.role]}</TableCell>
                    <TableCell>{u.branch_id ? branchName.get(u.branch_id) ?? "—" : "All branches"}</TableCell>
                    <TableCell className="text-muted-foreground">{u.employee_id ? empName.get(u.employee_id) ?? "—" : "—"}</TableCell>
                    <TableCell>{u.is_active ? <span className="text-[#087a08]">Active</span> : <span className="text-muted-foreground">Inactive</span>}</TableCell>
                    <TableCell className="tabular text-muted-foreground">{formatDate(u.created_at)}</TableCell>
                    <TableCell className="pr-5 text-right"><UserDialog user={u} branches={lookups.branches} employees={lookups.employees} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
        <Panel title="Role permissions">
          <dl className="space-y-3 text-sm">
            {ROLE_HELP.map((r) => (
              <div key={r.role}>
                <dt className="font-medium">{r.role}</dt>
                <dd className="text-muted-foreground">{r.text}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </>
  );
}
