"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/admin/form-field";
import { Panel } from "@/components/admin/panel";
import { renderTemplate, smsSegments } from "@/lib/messaging/template";
import { formatDate } from "@/lib/format";
import { saveTemplateAction } from "../actions";

interface Tpl {
  id: string;
  survey_type: "purchased" | "non_purchased";
  name: string;
  body: string;
  is_default: boolean;
  is_active: boolean;
  updated_at: string;
}

const EMPTY: Omit<Tpl, "id" | "updated_at"> = { survey_type: "purchased", name: "", body: "Hi {{customer_name}}, … {{survey_link}}", is_default: false, is_active: true };

export function TemplateManager({ templates, canEdit }: { templates: Tpl[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<{ id: string | null; v: Omit<Tpl, "id" | "updated_at"> } | null>(null);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const seg = editing ? smsSegments(renderTemplate(editing.v.body, { customerName: "Nimal", branchName: "iSeven Mobiles", brandName: "iSeven Mobiles", surveyLink: `https://cx.idealz.lk/s/${"x".repeat(22)}` })) : null;

  return (
    <>
      {canEdit && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => { setErrors({}); setEditing({ id: null, v: { ...EMPTY } }); }}>
            <Plus data-icon="inline-start" /> New template
          </Button>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {(["purchased", "non_purchased"] as const).map((type) => (
          <Panel key={type} title={type === "purchased" ? "Purchased customer templates" : "Non-purchased customer templates"}>
            <ul className="space-y-3">
              {templates.filter((t) => t.survey_type === type).map((t) => (
                <li key={t.id} className="rounded-lg border border-border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {t.name}
                      {t.is_default && <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand">Default</span>}
                      {!t.is_active && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Inactive</span>}
                    </p>
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => { setErrors({}); setEditing({ id: t.id, v: { survey_type: t.survey_type, name: t.name, body: t.body, is_default: t.is_default, is_active: t.is_active } }); }}>
                        <Pencil data-icon="inline-start" /> Edit
                      </Button>
                    )}
                  </div>
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">{t.body}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground">Updated {formatDate(t.updated_at)}</p>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit template" : "New template"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <FormField label="Survey type" htmlFor="tpl-type">
                <NativeSelect id="tpl-type" value={editing.v.survey_type} disabled={!!editing.id} onChange={(e) => setEditing({ ...editing, v: { ...editing.v, survey_type: e.target.value as Tpl["survey_type"] } })}>
                  <option value="purchased">Purchased customer</option>
                  <option value="non_purchased">Non-purchased customer</option>
                </NativeSelect>
              </FormField>
              <FormField label="Name" htmlFor="tpl-name" required error={errors.name?.[0]}>
                <Input id="tpl-name" value={editing.v.name} onChange={(e) => setEditing({ ...editing, v: { ...editing.v, name: e.target.value } })} />
              </FormField>
              <FormField label="Message" htmlFor="tpl-body" required error={errors.body?.[0]} hint={seg ? `${seg.characters} chars with a real link · ${seg.segments} segment(s) · ${seg.encoding}` : undefined}>
                <Textarea id="tpl-body" rows={5} value={editing.v.body} onChange={(e) => setEditing({ ...editing, v: { ...editing.v, body: e.target.value } })} />
              </FormField>
              <div className="flex gap-6 text-sm">
                <label className="flex items-center gap-2"><Checkbox checked={editing.v.is_default} onCheckedChange={(v) => setEditing({ ...editing, v: { ...editing.v, is_default: v } })} /> Default</label>
                <label className="flex items-center gap-2"><Checkbox checked={editing.v.is_active} onCheckedChange={(v) => setEditing({ ...editing, v: { ...editing.v, is_active: v } })} /> Active</label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() =>
                editing &&
                start(async () => {
                  const res = await saveTemplateAction(editing.id, editing.v);
                  if (!res.ok) {
                    setErrors(("fieldErrors" in res && res.fieldErrors ? res.fieldErrors : {}) as Record<string, string[] | undefined>);
                    return void toast.error(res.error);
                  }
                  toast.success("Template saved");
                  setEditing(null);
                  router.refresh();
                })
              }
            >
              {pending && <Loader2 className="animate-spin" data-icon="inline-start" />} Save template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
