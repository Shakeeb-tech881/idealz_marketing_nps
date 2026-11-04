"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/admin/form-field";
import { ROLE_LABELS, type AppRole, type Branch, type Employee, type Profile } from "@/lib/types";
import { inviteUserAction, updateUserAction } from "./actions";

export function UserDialog({ user, branches, employees }: { user?: Profile; branches: Branch[]; employees: Employee[] }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({
    email: user?.email ?? "",
    full_name: user?.full_name ?? "",
    role: (user?.role ?? "staff") as AppRole,
    branch_id: user?.branch_id ?? "",
    employee_id: user?.employee_id ?? "",
    is_active: user?.is_active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const scoped = v.role === "branch_manager" || v.role === "staff";

  function save() {
    start(async () => {
      const payload = { ...v, branch_id: scoped ? v.branch_id : "", employee_id: v.employee_id };
      const res = user ? await updateUserAction(user.id, payload) : await inviteUserAction(payload);
      if (!res.ok) {
        setErrors(("fieldErrors" in res && res.fieldErrors ? res.fieldErrors : {}) as Record<string, string[] | undefined>);
        return void toast.error(res.error);
      }
      toast.success(user ? "User updated" : `Invitation sent to ${v.email}`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={user ? <Button variant="ghost" size="sm" /> : <Button />}>
        {user ? <><Pencil data-icon="inline-start" /> Edit</> : <><UserPlus data-icon="inline-start" /> Invite user</>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user ? "Edit user" : "Invite a user"}</DialogTitle>
          <DialogDescription>{user ? user.email : "They will receive an email to set their password."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!user && (
            <FormField label="Email" htmlFor="u-email" required error={errors.email?.[0]}>
              <Input id="u-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
            </FormField>
          )}
          <FormField label="Full name" htmlFor="u-name" required error={errors.full_name?.[0]}>
            <Input id="u-name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} />
          </FormField>
          <FormField label="Role" htmlFor="u-role" required>
            <NativeSelect id="u-role" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as AppRole })}>
              {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </NativeSelect>
          </FormField>
          {scoped && (
            <FormField label="Branch" htmlFor="u-branch" required error={errors.branch_id?.[0]}>
              <NativeSelect id="u-branch" value={v.branch_id} onChange={(e) => setV({ ...v, branch_id: e.target.value, employee_id: "" })}>
                <option value="">Select branch…</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </NativeSelect>
            </FormField>
          )}
          <FormField label="Linked employee record" htmlFor="u-emp" hint="Staff see feedback linked to this employee">
            <NativeSelect id="u-emp" value={v.employee_id} onChange={(e) => setV({ ...v, employee_id: e.target.value })}>
              <option value="">None</option>
              {employees.filter((e) => !v.branch_id || e.branch_id === v.branch_id).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </NativeSelect>
          </FormField>
          {user && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={v.is_active} onCheckedChange={(c) => setV({ ...v, is_active: c })} /> Active (inactive users cannot sign in)
            </label>
          )}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />} {user ? "Save changes" : "Send invitation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
