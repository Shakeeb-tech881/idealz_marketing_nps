"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Award,
  CalendarOff,
  ChartNoAxesCombined,
  FileDown,
  LayoutDashboard,
  Megaphone,
  Menu,
  MessageSquareText,
  Send,
  Settings,
  ShieldCheck,
  Star,
  Store,
  UserRoundCheck,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { NavItem } from "./nav-config";

const ICONS: Record<string, LucideIcon> = {
  Award,
  CalendarOff,
  LayoutDashboard,
  MessageSquareText,
  Users,
  UsersRound,
  Megaphone,
  Send,
  ChartNoAxesCombined,
  Store,
  UserRoundCheck,
  FileDown,
  ShieldCheck,
  Settings,
  Star,
};

function NavList({ sections, onNavigate }: { sections: { title: string; items: NavItem[] }[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-6 px-3" aria-label="Main">
      {sections.map((s) => (
        <div key={s.title}>
          <p className="mb-1.5 px-3 text-[10px] font-semibold tracking-[0.12em] text-white/40 uppercase">{s.title}</p>
          <ul className="space-y-0.5">
            {s.items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      active ? "bg-white/10 font-medium text-white" : "text-white/70 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ sections, brandName, logoUrl }: { sections: { title: string; items: NavItem[] }[]; brandName: string; logoUrl: string | null }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-sidebar py-5 lg:flex">
      <div className="mb-8 px-6">
        <Logo inverted name={brandName} logoUrl={logoUrl} />
        <p className="mt-1 text-[11px] text-white/50">Customer Experience</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        <NavList sections={sections} />
      </div>
    </aside>
  );
}

export function MobileNav({ sections, brandName, logoUrl }: { sections: { title: string; items: NavItem[] }[]; brandName: string; logoUrl: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-white lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-4" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 border-none bg-sidebar p-0 py-5 text-white">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="mb-8 px-6">
          <Logo inverted name={brandName} logoUrl={logoUrl} />
        </div>
        <NavList sections={sections} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
