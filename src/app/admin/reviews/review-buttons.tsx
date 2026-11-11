"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setReviewStatusAction } from "./actions";

export function ReviewButtons({ id, status }: { id: string; status: "asked" | "confirmed" | "not_found" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (next: "asked" | "confirmed" | "not_found", msg: string) =>
    start(async () => {
      const res = await setReviewStatusAction(id, next);
      if (!res.ok) return void toast.error(res.error);
      toast.success(msg);
      router.refresh();
    });
  if (pending) return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  if (status !== "asked") {
    return (
      <Button size="sm" variant="ghost" onClick={() => set("asked", "Check undone")}>
        <Undo2 data-icon="inline-start" /> Undo
      </Button>
    );
  }
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="outline" onClick={() => set("confirmed", "Review confirmed – counts for the rep")}>
        <Check data-icon="inline-start" /> Found on Google
      </Button>
      <Button size="sm" variant="ghost" onClick={() => set("not_found", "Marked as not found")}>
        <X data-icon="inline-start" /> Not found
      </Button>
    </div>
  );
}
