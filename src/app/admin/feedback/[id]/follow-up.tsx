"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { FormField } from "@/components/admin/form-field";
import { RESOLUTION_LABELS, type ResolutionStatus } from "@/lib/types";
import { addNoteAction, updateFeedbackAction } from "../actions";

export function FollowUpForm({ responseId, initial, assignees }: { responseId: string; initial: { resolution_status: ResolutionStatus; assigned_to: string | null; follow_up_due: string | null }; assignees: { id: string; label: string }[] }) {
  const [v, setV] = useState({ resolution_status: initial.resolution_status, assigned_to: initial.assigned_to ?? "", follow_up_due: initial.follow_up_due ?? "" });
  const [pending, start] = useTransition();
  const router = useRouter();
  const dirty = v.resolution_status !== initial.resolution_status || v.assigned_to !== (initial.assigned_to ?? "") || v.follow_up_due !== (initial.follow_up_due ?? "");
  return (
    <div className="space-y-3">
      <FormField label="Resolution status" htmlFor="fu-status">
        <NativeSelect id="fu-status" value={v.resolution_status} onChange={(e) => setV({ ...v, resolution_status: e.target.value as ResolutionStatus })}>
          {(Object.keys(RESOLUTION_LABELS) as ResolutionStatus[]).map((s) => <option key={s} value={s}>{RESOLUTION_LABELS[s]}</option>)}
        </NativeSelect>
      </FormField>
      <FormField label="Assigned to" htmlFor="fu-assignee">
        <NativeSelect id="fu-assignee" value={v.assigned_to} onChange={(e) => setV({ ...v, assigned_to: e.target.value })}>
          <option value="">Unassigned</option>
          {assignees.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </NativeSelect>
      </FormField>
      <FormField label="Follow-up due" htmlFor="fu-due">
        <Input id="fu-due" type="date" value={v.follow_up_due} onChange={(e) => setV({ ...v, follow_up_due: e.target.value })} />
      </FormField>
      <Button
        className="w-full"
        disabled={!dirty || pending}
        onClick={() =>
          start(async () => {
            const res = await updateFeedbackAction(responseId, { resolution_status: v.resolution_status, assigned_to: v.assigned_to || null, follow_up_due: v.follow_up_due || null });
            if (!res.ok) return void toast.error(res.error);
            toast.success("Follow-up updated");
            router.refresh();
          })
        }
      >
        {pending && <Loader2 className="animate-spin" data-icon="inline-start" />} Save follow-up
      </Button>
    </div>
  );
}

export function NoteForm({ responseId }: { responseId: string }) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-2">
      <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add an internal note (e.g. called customer, offered replacement)…" maxLength={4000} />
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!body.trim() || pending}
          onClick={() =>
            start(async () => {
              const res = await addNoteAction(responseId, body);
              if (!res.ok) return void toast.error(res.error);
              setBody("");
              router.refresh();
            })
          }
        >
          {pending && <Loader2 className="animate-spin" data-icon="inline-start" />} Add note
        </Button>
      </div>
    </div>
  );
}
