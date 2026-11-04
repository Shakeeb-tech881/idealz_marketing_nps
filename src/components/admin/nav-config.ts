import type { AppRole } from "@/lib/types";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  roles: AppRole[];
}

const ALL: AppRole[] = ["super_admin", "management", "branch_manager", "staff"];
const MANAGERS: AppRole[] = ["super_admin", "management", "branch_manager"];

export const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [
      { href: "/admin", label: "Dashboard", icon: "LayoutDashboard", roles: MANAGERS },
      { href: "/admin/feedback", label: "Customer Feedback", icon: "MessageSquareText", roles: ALL },
    ],
  },
  {
    title: "Customers",
    items: [
      { href: "/admin/customers", label: "Customers", icon: "Users", roles: ALL },
      { href: "/admin/messaging", label: "Survey Messaging", icon: "Send", roles: ALL },
    ],
  },
  {
    title: "Analytics",
    items: [
      { href: "/admin/analytics", label: "NPS & Insights", icon: "ChartNoAxesCombined", roles: MANAGERS },
      { href: "/admin/branches", label: "Branch Analytics", icon: "Store", roles: MANAGERS },
      { href: "/admin/employees", label: "Employee Analytics", icon: "UserRoundCheck", roles: MANAGERS },
      { href: "/admin/reports", label: "Reports", icon: "FileDown", roles: MANAGERS },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/admin/users", label: "Users & Roles", icon: "ShieldCheck", roles: ["super_admin"] },
      { href: "/admin/settings", label: "Settings", icon: "Settings", roles: ["super_admin"] },
    ],
  },
];

export function navFor(role: AppRole) {
  return NAV_SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => i.roles.includes(role)) })).filter((s) => s.items.length);
}
