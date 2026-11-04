import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { buttonVariants } from "@/components/ui/button";

export default function ForbiddenPage() {
  return (
    <div className="rounded-xl border border-border bg-card">
      <EmptyState
        icon={ShieldAlert}
        title="You don't have access to this page"
        description="Your role does not include this area. Contact a Super Admin if you need access."
        action={<Link href="/admin/feedback" className={buttonVariants({ variant: "outline" })}>Go to customer feedback</Link>}
      />
    </div>
  );
}
