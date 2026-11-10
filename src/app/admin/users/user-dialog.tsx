"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Loader2, Pencil, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/admin/form-field";
import { ROLE_LABELS, type AppRole, type Branch, type Employee, type Profile } from "@/lib/types";
import { createUserWithTemporaryPasswordAction, inviteUserAction, setTemporaryPasswordAction, updateUserAction } from "./actions";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error("Could not copy – select the text and copy it manually.");
        }
      }}
    >
      {done ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />} {label}
    </Button>
  );
}

/** Shows a temporary password ONCE. It is not stored anywhere readable and cannot be shown again. */
function TemporaryPasswordDialog({ creds, onClose }: { creds: { email: string; password: string } | null; onClose: () => void }) {
  if (!creds) return null;
  const loginUrl = `${window.location.origin}/login`;
  const message = `Your iDealz Lanka Customer Experience login:\n${loginUrl}\nEmail: ${creds.email}\nTemporary password: ${creds.password}\nYou will be asked to choose your own password when you sign in.`;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Temporary password</DialogTitle>
          <DialogDescription>Shown only once. Send it to the person privately (for example WhatsApp). They must choose their own password when they sign in.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="font-medium break-all">{creds.email}</p>
            <p className="mt-2 text-xs text-muted-foreground">Temporary password</p>
            <p className="font-mono text-lg font-semibold tracking-wide select-all">{creds.password}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={creds.password} label="Copy password" />
            <CopyButton text={message} label="Copy WhatsApp message" />
          </div>
          <p className="text-xs text-muted-foreground">If it is lost, use Edit → Set temporary password again to make a new one.</p>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UserDialog({ user, branches, employees }: { user?: Profile; branches: Branch[]; employees: Employee[] }) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"password" | "email">("password");
  const [creds, setCreds] = useState<{ email: string; password: string } | null>(null);
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
      const showErrors = (res: { error: string; fieldErrors?: Record<string, string[] | undefined> }) => {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
      };
      if (!user && method === "password") {
        const res = await createUserWithTemporaryPasswordAction(payload);
        if (!res.ok) return void showErrors(res);
        setOpen(false);
        setCreds({ email: res.email, password: res.password });
        toast.success(`Login created for ${res.email}`);
        return;
      }
      const res = user ? await updateUserAction(user.id, payload) : await inviteUserAction(payload);
      if (!res.ok) return void showErrors(res);
      toast.success(user ? "User updated" : `Invitation sent to ${v.email}`);
      setOpen(false);
      router.refresh();
    });
  }

  function resetPassword() {
    if (!user) return;
    if (!confirm(`Set a new temporary password for ${user.email}?\n\nTheir current password will stop working. They will have to choose their own password when they sign in.`)) return;
    start(async () => {
      const res = await setTemporaryPasswordAction(user.id);
      if (!res.ok) return void toast.error(res.error);
      setOpen(false);
      setCreds({ email: res.email, password: res.password });
    });
  }

  return (
    <>
    <TemporaryPasswordDialog
      creds={creds}
      onClose={() => {
        setCreds(null);
        router.refresh();
      }}
    />
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={user ? <Button variant="ghost" size="sm" /> : <Button />}>
        {user ? <><Pencil data-icon="inline-start" /> Edit</> : <><UserPlus data-icon="inline-start" /> Add user</>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user ? "Edit user" : "Add a user"}</DialogTitle>
          <DialogDescription>{user ? user.email : method === "password" ? "You get a temporary password to send them. No email needed." : "They will receive an email to set their password."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!user && (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">How will they sign in?</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="u-method" className="mt-1 accent-primary" checked={method === "password"} onChange={() => setMethod("password")} />
                <span>Temporary password <span className="text-muted-foreground">– you send it to them (e.g. WhatsApp). Works immediately.</span></span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="u-method" className="mt-1 accent-primary" checked={method === "email"} onChange={() => setMethod("email")} />
                <span>Invitation email <span className="text-muted-foreground">– needs custom SMTP in Supabase to reach staff inboxes.</span></span>
              </label>
            </fieldset>
          )}
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
        <DialogFooter className="sm:justify-between">
          {user ? (
            <Button type="button" variant="outline" onClick={resetPassword} disabled={pending}>
              <KeyRound data-icon="inline-start" /> Set temporary password
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />} {user ? "Save changes" : method === "password" ? "Create login" : "Send invitation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
