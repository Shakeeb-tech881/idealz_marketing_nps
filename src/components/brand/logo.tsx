import { cn } from "@/lib/utils";

/**
 * iDealz Lanka wordmark. If a logo URL is configured in Settings it is used
 * instead; otherwise a typographic wordmark is rendered.
 */
export function Logo({ logoUrl, className, inverted = false, name = "iDealz Lanka" }: { logoUrl?: string | null; className?: string; inverted?: boolean; name?: string }) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt={name} className={cn("h-8 w-auto", className)} />;
  }
  const [first, ...rest] = name.split(" ");
  return (
    <span className={cn("inline-flex items-baseline gap-1 font-semibold tracking-tight text-xl select-none", inverted ? "text-white" : "text-brand", className)} aria-label={name}>
      <span>{first}</span>
      {rest.length > 0 && <span className={cn("font-normal", inverted ? "text-white/70" : "text-muted-foreground")}>{rest.join(" ")}</span>}
    </span>
  );
}
