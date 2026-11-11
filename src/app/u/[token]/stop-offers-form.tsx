"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { stopOffersAction } from "./actions";

export function StopOffersForm({ token, brandName }: { token: string; brandName: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <div className="flex flex-col items-center text-center">
        <CheckCircle2 className="mb-3 size-12 text-promoter" strokeWidth={1.75} />
        <h1 className="text-xl font-semibold">Done – no more offers</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">You will not receive offer SMS from {brandName} any more. After a purchase you may still get a short feedback survey.</p>
      </div>
    );
  }
  return (
    <div className="text-center">
      <h1 className="text-xl font-semibold">Stop offer SMS from {brandName}?</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">You will no longer receive messages about new models and offers.</p>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      <Button
        className="mt-5 h-11 w-full"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await stopOffersAction(token);
            if (res.ok) setDone(true);
            else setError(res.error);
          })
        }
      >
        {pending && <Loader2 className="animate-spin" data-icon="inline-start" />} Yes, stop offers
      </Button>
    </div>
  );
}
