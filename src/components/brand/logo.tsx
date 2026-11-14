import { cn } from "@/lib/utils";

/** The iDealz logo files (public/brand). The white version is for dark backgrounds such as the sidebar. */
const IDEALZ_LOGO = { src: "/brand/idealz-logo.png", white: "/brand/idealz-logo-white.png", width: 794, height: 314 };

/** True for the company's own brand ("iDealz Lanka", "iDealz", …), not for other showroom brands such as iSeven Mobiles. */
function isIdealzBrand(name: string) {
  return /^\s*idealz\b/i.test(name);
}

/**
 * Brand logo.
 * - A logo URL configured in Settings wins.
 * - The iDealz brand shows the built-in iDealz logo (white on dark backgrounds).
 * - Any other showroom brand (e.g. iSeven Mobiles) shows its name as a text wordmark.
 */
export function Logo({
  logoUrl,
  className,
  inverted = false,
  name = "iDealz Lanka",
  size = "md",
}: {
  logoUrl?: string | null;
  className?: string;
  inverted?: boolean;
  name?: string;
  /** md: sidebar · lg: sign-in and survey pages */
  size?: "md" | "lg";
}) {
  const height = size === "lg" ? "h-11" : "h-8";
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt={name} className={cn(height, "w-auto", className)} />;
  }
  if (isIdealzBrand(name)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={inverted ? IDEALZ_LOGO.white : IDEALZ_LOGO.src}
        alt={name}
        width={IDEALZ_LOGO.width}
        height={IDEALZ_LOGO.height}
        className={cn(height, "w-auto select-none", className)}
        draggable={false}
      />
    );
  }
  const [first, ...rest] = name.split(" ");
  return (
    <span className={cn("inline-flex items-baseline gap-1 font-semibold tracking-tight text-xl select-none", inverted ? "text-white" : "text-brand", className)} aria-label={name}>
      <span>{first}</span>
      {rest.length > 0 && <span className={cn("font-normal", inverted ? "text-white/70" : "text-muted-foreground")}>{rest.join(" ")}</span>}
    </span>
  );
}
