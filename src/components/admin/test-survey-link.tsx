"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TestBadge } from "@/components/admin/badges";

/** A survey link with Copy and Open buttons. Only ever shown in SMS test mode. */
export function TestSurveyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={url} className="h-8 min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="Test survey link" />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            /* clipboard blocked – the field can still be selected and copied */
          }
        }}
      >
        {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />} {copied ? "Copied" : "Copy"}
      </Button>
      <a href={url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "sm", variant: "outline" })}>
        <ExternalLink data-icon="inline-start" /> Open
      </a>
    </div>
  );
}

/** Pops up after a test-mode send so the tester can open the survey. */
export function TestSurveyLinkDialog({ url, onClose }: { url: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!url} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TestBadge /> Test survey link
          </DialogTitle>
          <DialogDescription>
            SMS test mode is on, so no SMS was sent. Open this link (on your phone or here) to fill in the survey as the customer would.
            It is shown only now and is not saved – sending again creates a new link and the old one stops working.
          </DialogDescription>
        </DialogHeader>
        {url && <TestSurveyLink url={url} />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
