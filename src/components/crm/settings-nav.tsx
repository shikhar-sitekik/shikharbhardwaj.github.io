import Link from "next/link";
import { cn } from "@/lib/cn";

const ITEMS = [
  { href: "/settings/users", label: "Users & teams", permission: "admin:users" },
  { href: "/settings/roles", label: "Roles & permissions", permission: "admin:roles" },
  { href: "/settings/general", label: "General & scoring", permission: "admin:settings" },
  { href: "/settings/audit", label: "Audit log", permission: "audit:read" },
  { href: "/settings/health", label: "System health", permission: "admin:settings" },
  { href: "/settings/profile", label: "My profile & sessions", permission: null },
] as const;

export function SettingsNav({ active, permissions }: { active: string; permissions: ReadonlySet<string> }) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-4 md:px-6" aria-label="Administration">
      {ITEMS.filter((i) => !i.permission || permissions.has(i.permission)).map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={active === i.href ? "page" : undefined}
          className={cn("-mb-px border-b-2 px-2 py-2.5 text-[12.5px] font-medium whitespace-nowrap", active === i.href ? "border-accent text-text" : "border-transparent text-text-3 hover:text-text")}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
