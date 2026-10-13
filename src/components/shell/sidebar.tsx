"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { useState } from "react";
import { BrandMark } from "@/components/brand";
import { cn } from "@/lib/cn";
import type { NavGroup } from "@/lib/navigation";
import { NAV_ICONS } from "./icons";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ groups, tenantName, initialCollapsed }: { groups: NavGroup[]; tenantName: string; initialCollapsed: boolean }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    // Per-user UI preference only; read server-side to avoid a layout flash.
    document.cookie = `sidebar=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-chrome-border bg-chrome text-chrome-text transition-[width] duration-150 md:flex",
        collapsed ? "w-[52px]" : "w-[228px]",
      )}
      aria-label="Primary"
    >
      <div className="flex h-12 items-center gap-2 border-b border-chrome-border px-3.5">
        <BrandMark className="size-[22px] shrink-0" />
        {!collapsed ? <span className="truncate text-[13px] font-semibold text-white">{tenantName}</span> : null}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-2.5">
        {groups.map((g) => (
          <div key={g.label} className="mb-3">
            {!collapsed ? (
              <p className="px-2 pb-1 text-[10.5px] font-semibold tracking-[0.06em] text-chrome-text-2 uppercase">{g.label}</p>
            ) : (
              <div className="mx-2 mb-1.5 h-px bg-chrome-border" />
            )}
            <ul className="flex flex-col gap-px">
              {g.items.map((item) => {
                const Icon = NAV_ICONS[item.icon] ?? NAV_ICONS.home!;
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-[30px] items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
                        active ? "bg-chrome-active text-white" : "hover:bg-chrome-2 hover:text-white",
                        item.status === "planned" && !active && "text-chrome-text-2",
                      )}
                    >
                      <Icon className="size-[15px] shrink-0" aria-hidden />
                      {!collapsed ? (
                        <>
                          <span className="truncate">{item.label}</span>
                          {item.status === "planned" ? (
                            <span className="ml-auto rounded-[3px] border border-chrome-border px-1 text-[9.5px] font-medium tracking-wide text-chrome-text-2 uppercase">
                              Soon
                            </span>
                          ) : null}
                        </>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <button
        type="button"
        onClick={toggle}
        className="flex h-10 items-center gap-2 border-t border-chrome-border px-4 text-[12px] text-chrome-text-2 hover:text-white"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        {!collapsed ? "Collapse" : null}
      </button>
    </aside>
  );
}
