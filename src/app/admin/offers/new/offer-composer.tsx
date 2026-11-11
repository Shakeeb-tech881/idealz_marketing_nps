"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/admin/form-field";
import { Panel } from "@/components/admin/panel";
import { OFFER_VARIABLES } from "@/lib/offers/template";
import { createCampaignAction, previewAudienceAction } from "../actions";

type Preview = Extract<Awaited<ReturnType<typeof previewAudienceAction>>, { ok: true }>["data"];

const EXAMPLE = "Hi {{customer_name}}, the new iPhone 17 is at {{brand_name}}! Upgrade from your old phone. Stop: {{optout_link}}";

const VARIABLE_HELP: Record<string, string> = {
  "{{customer_name}}": "first name",
  "{{last_model}}": "last model they bought",
  "{{branch_name}}": "their showroom",
  "{{brand_name}}": "iDealz Lanka / iSeven Mobiles",
  "{{optout_link}}": "one-tap stop link (required)",
};

export function OfferComposer({ filters }: { filters: Record<string, string> }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [body, setBody] = useState(EXAMPLE);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, startSave] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await previewAudienceAction(filters, body);
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) return void toast.error(res.error);
      setPreview(res.data);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [filters, body]);

  function insert(v: string) {
    const el = textRef.current;
    if (!el) return setBody((b) => `${b}${v}`);
    const { selectionStart: s, selectionEnd: e } = el;
    setBody((b) => b.slice(0, s) + v + b.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + v.length, s + v.length);
    });
  }

  function save() {
    startSave(async () => {
      const res = await createCampaignAction({ name, body, filters });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Offer saved – review and press Start to send");
      router.push(`/admin/offers/${res.id}`);
    });
  }

  const blocked = !preview || preview.problems.length > 0 || preview.recipients === 0 || !name.trim();

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Panel title="Message">
        <div className="space-y-4">
          <FormField label="Offer name (for your records)" htmlFor="o-name" required hint="e.g. “iPhone 17 launch – iPhone 13/14 owners”">
            <Input id="o-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </FormField>
          <FormField label="SMS text" htmlFor="o-body" required>
            <Textarea id="o-body" ref={textRef} rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} />
          </FormField>
          <div className="flex flex-wrap gap-1.5">
            {OFFER_VARIABLES.map((v) => (
              <button key={v} type="button" onClick={() => insert(v)} className="rounded-md border border-border bg-muted/50 px-2 py-1 text-xs hover:bg-muted" title={VARIABLE_HELP[v]}>
                <code>{v}</code> <span className="text-muted-foreground">{VARIABLE_HELP[v]}</span>
              </button>
            ))}
          </div>
          {preview && preview.problems.length > 0 && (
            <ul className="list-disc space-y-1 rounded-lg bg-destructive/5 p-3 pl-8 text-sm text-destructive">{preview.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          )}
          {preview && (
            <div className="rounded-lg bg-muted/60 p-3 text-sm">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Longest version a customer could get</p>
              <p className="whitespace-pre-wrap">{preview.exampleText}</p>
              <p className={`mt-2 text-xs ${preview.segments > 1 ? "font-medium text-[#8a5f00]" : "text-muted-foreground"}`}>
                ~{preview.characters} characters · {preview.segments} SMS per customer ({preview.encoding})
                {preview.segments > 1 && " – shorten it to pay for 1 SMS per customer"}
                {preview.encoding === "UCS-2" && " – a special character (emoji, curly quote ’ or Sinhala/Tamil) makes each SMS only 70 characters"}
              </p>
            </div>
          )}
        </div>
      </Panel>
      <div className="space-y-4">
        <Panel title="Who gets it">
          {loading && !preview ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Counting customers…</p>
          ) : preview ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">{preview.description}</p>
              <p className="flex items-center gap-2 text-2xl font-semibold tabular">
                <Users className="size-5 text-muted-foreground" /> {preview.recipients.toLocaleString()}
                <span className="text-sm font-normal text-muted-foreground">customer{preview.recipients === 1 ? "" : "s"}</span>
                {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              </p>
              {preview.capped && (
                <p className="flex gap-2 rounded-lg bg-passive-soft p-2 text-[#8a5f00]"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> {preview.total.toLocaleString()} match; one offer can go to at most {preview.recipients.toLocaleString()}. Narrow the filters or send in parts.</p>
              )}
              {preview.sample.length > 0 && (
                <p className="text-muted-foreground">e.g. {preview.sample.map((s) => `${s.name}${s.model ? ` (${s.model})` : ""}`).join(", ")}{preview.recipients > preview.sample.length ? "…" : ""}</p>
              )}
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Estimated SMS (charged by Dialog)</p>
                <p className="text-lg font-semibold tabular">{preview.estimatedSms.toLocaleString()} SMS</p>
                <p className="text-xs text-muted-foreground">{preview.recipients.toLocaleString()} customers × {preview.segments} SMS each, at most. Check your eSMS wallet balance first.</p>
              </div>
              <p className="text-xs text-muted-foreground">Always left out: customers who stopped offers or SMS, and customers without a mobile number.</p>
            </div>
          ) : null}
        </Panel>
        <Button className="h-10 w-full" onClick={save} disabled={blocked || saving}>
          {saving && <Loader2 className="animate-spin" data-icon="inline-start" />} Save offer ({preview?.recipients.toLocaleString() ?? 0} customers)
        </Button>
        <p className="text-center text-xs text-muted-foreground">Saving does not send. You start sending on the next screen.</p>
      </div>
    </div>
  );
}
