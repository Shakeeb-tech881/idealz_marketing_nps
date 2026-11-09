"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, RotateCw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/admin/form-field";
import type { Branch, Employee } from "@/lib/types";
import { setOptOutAction, updateContactAction } from "../actions";
import { resendInvitationAction, sendInvitationsAction } from "../../messaging/actions";
import { AddInteractionForm } from "../customer-form";
import { TestSurveyLinkDialog } from "@/components/admin/test-survey-link";

export function EditContactDialog({ customerId, initial }: { customerId: string; initial: { full_name: string; mobile: string; email: string } }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Pencil data-icon="inline-start" /> Edit
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit customer</DialogTitle>
          <DialogDescription>Changes apply to all of this customer&apos;s records.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {(["full_name", "mobile", "email"] as const).map((k) => (
            <FormField key={k} label={k === "full_name" ? "Name" : k === "mobile" ? "Mobile" : "Email"} htmlFor={k} error={errors[k]?.[0]} required={k !== "email"}>
              <Input id={k} value={values[k]} onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
            </FormField>
          ))}
        </div>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await updateContactAction(customerId, values);
                if (!res.ok) {
                  setErrors(res.fieldErrors ?? {});
                  toast.error(res.error);
                  return;
                }
                toast.success("Customer updated");
                setOpen(false);
                router.refresh();
              })
            }
          >
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OptOutToggle({ customerId, optedOut }: { customerId: string; optedOut: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant={optedOut ? "outline" : "ghost"}
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (!optedOut && !confirm("Mark this customer as opted out? No further survey SMS will be sent.")) return;
          const res = await setOptOutAction(customerId, !optedOut);
          if (!res.ok) return void toast.error(res.error);
          toast.success(optedOut ? "SMS re-enabled" : "Customer opted out of SMS");
          router.refresh();
        })
      }
    >
      {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
      {optedOut ? "Re-enable SMS" : "Mark SMS opt-out"}
    </Button>
  );
}

export function SendSurveyButton({ interactionId, surveyType, disabled }: { interactionId: string; surveyType: "purchased" | "non_purchased"; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [testLink, setTestLink] = useState<string | null>(null);
  const router = useRouter();
  return (
    <>
    <Button
      size="sm"
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          if (!confirm(`Send the ${surveyType === "purchased" ? "purchased" : "non-purchased"} customer survey SMS now?`)) return;
          const res = await sendInvitationsAction({ interactionIds: [interactionId], surveyType });
          if (!res.ok) return void toast.error(res.error);
          const o = res.data.outcomes[0];
          if (o?.status === "sent") {
            toast.success(res.data.isTest ? "Test message logged (not sent – SMS test mode)" : "Survey SMS sent");
            // Refreshing swaps this button for "Resend", which would close the dialog —
            // so in test mode the page refreshes only when the link dialog is closed.
            if (o.testLink) return void setTestLink(o.testLink);
          } else toast.error(o?.reason ?? "Message was not sent");
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />} Send survey
    </Button>
    <TestSurveyLinkDialog
      url={testLink}
      onClose={() => {
        setTestLink(null);
        router.refresh();
      }}
    />
    </>
  );
}

export function ResendButton({ invitationId, failed }: { invitationId: string; failed: boolean }) {
  const [pending, start] = useTransition();
  const [testLink, setTestLink] = useState<string | null>(null);
  const router = useRouter();
  return (
    <>
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (!confirm(failed ? "Retry sending this survey SMS?" : "Resend the survey SMS? The previous link will stop working.")) return;
          const res = await resendInvitationAction(invitationId, failed);
          if (!res.ok) return void toast.error(res.error);
          toast.success(res.data.isTest ? "Test message logged (not sent – SMS test mode)" : "Survey SMS sent");
          if (res.data.testLink) return void setTestLink(res.data.testLink);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <RotateCw data-icon="inline-start" />} {failed ? "Retry" : "Resend"}
    </Button>
    <TestSurveyLinkDialog
      url={testLink}
      onClose={() => {
        setTestLink(null);
        router.refresh();
      }}
    />
    </>
  );
}

export function AddInteractionDialog(props: { customerId: string; branches: Branch[]; employees: Employee[]; defaultBranch: string | null; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus data-icon="inline-start" /> New purchase / visit
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New purchase or visit</DialogTitle>
          <DialogDescription>Record another interaction for this customer.</DialogDescription>
        </DialogHeader>
        <AddInteractionForm {...props} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
