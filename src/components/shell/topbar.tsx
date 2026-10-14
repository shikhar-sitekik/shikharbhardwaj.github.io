"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, LogOut, Menu, Monitor, Moon, Plus, Search, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import * as D from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { DropdownContent, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { initials } from "@/lib/format";
import type { NavGroup } from "@/lib/navigation";
import { logoutAction, logoutEverywhereAction } from "@/server/actions/auth";
import { setThemeAction } from "@/server/actions/preferences";
import { CommandPalette, type CreateAction } from "./command-palette";
import { NAV_ICONS } from "./icons";
import { BrandMark, BrandLogo } from "@/components/brand";

export function TopBar({
  user,
  roleName,
  groups,
  createActions,
  unread,
}: {
  user: { name: string; email: string };
  roleName: string;
  groups: NavGroup[];
  createActions: CreateAction[];
  unread: number;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let pendingG = false;
    let timer: number | undefined;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      // "g" then a letter: g h home, g l leads, g a accounts, g c contacts, g o opportunities, g t tasks.
      if (pendingG) {
        const dest: Record<string, string> = { h: "/", l: "/leads", a: "/accounts", c: "/contacts", o: "/opportunities", t: "/tasks", d: "/dashboard" };
        const href = dest[e.key.toLowerCase()];
        pendingG = false;
        if (href) {
          e.preventDefault();
          router.push(href);
        }
        return;
      }
      if (e.key === "g") {
        pendingG = true;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => (pendingG = false), 900);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
  }, [router]);

  const navItems = groups.flatMap((g) => g.items);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 md:px-4">
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
        <Menu className="size-4" />
      </Button>
      <BrandMark size={28} className="shrink-0 md:hidden" />
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="flex h-8 w-full max-w-[420px] items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 text-left text-[13px] text-text-3 hover:border-border-strong"
        aria-label="Search (Ctrl+K)"
      >
        <Search className="size-3.5" />
        <span className="flex-1 truncate">Search…</span>
        <kbd className="hidden rounded border border-border bg-surface px-1.5 text-[10.5px] sm:inline">⌘K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-1.5">
        {createActions.length > 0 ? (
          <DropdownMenu>
            <DropdownTrigger asChild>
              <Button variant="primary" size="md" aria-label="Add new">
                <Plus /> <span className="hidden sm:inline">Add</span>
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              {createActions.map((a) => (
                <DropdownItem key={a.href} asChild>
                  <Link href={a.href}>{a.label}</Link>
                </DropdownItem>
              ))}
            </DropdownContent>
          </DropdownMenu>
        ) : null}
        <Button variant="ghost" size="icon" asChild aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
          <Link href="/notifications" className="relative">
            <Bell className="size-4" />
            {unread > 0 ? <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-danger" /> : null}
          </Link>
        </Button>
        <DropdownMenu>
          <DropdownTrigger asChild>
            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-[11.5px] font-semibold text-accent"
              aria-label="Account menu"
            >
              {initials(user.name)}
            </button>
          </DropdownTrigger>
          <DropdownContent className="w-60">
            <div className="px-2 py-1.5">
              <p className="truncate text-[13px] font-medium">{user.name}</p>
              <p className="truncate text-[12px] text-text-3">{user.email}</p>
              <p className="mt-0.5 text-[11.5px] text-text-3">{roleName}</p>
            </div>
            <DropdownSeparator />
            <DropdownLabel>Theme</DropdownLabel>
            {(
              [
                ["system", "System", Monitor],
                ["light", "Light", Sun],
                ["dark", "Dark", Moon],
              ] as const
            ).map(([v, label, Icon]) => (
              <DropdownItem
                key={v}
                onSelect={async () => {
                  await setThemeAction(v);
                  router.refresh();
                }}
              >
                <Icon /> {label}
              </DropdownItem>
            ))}
            <DropdownSeparator />
            <DropdownItem asChild>
              <Link href="/settings/profile">Profile & sessions</Link>
            </DropdownItem>
            <DropdownItem onSelect={() => void logoutAction()}>
              <LogOut /> Sign out
            </DropdownItem>
            <DropdownItem onSelect={() => void logoutEverywhereAction()}>
              <LogOut /> Sign out of all sessions
            </DropdownItem>
          </DropdownContent>
        </DropdownMenu>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} navItems={navItems} createActions={createActions} />
      <D.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 bg-[#0b1426]/45 md:hidden" />
          <D.Content className="fixed inset-y-0 left-0 z-50 w-[260px] overflow-y-auto bg-chrome p-2 text-chrome-text md:hidden" aria-describedby={undefined}>
            <D.Title className="mb-2 flex h-14 items-center rounded-md bg-white px-3">
              <BrandLogo height={34} />
              <span className="sr-only">Navigation</span>
            </D.Title>
            {groups.map((g) => (
              <div key={g.label} className="mb-2">
                {g.label ? <p className="px-2 py-1 text-[10.5px] font-semibold tracking-[0.06em] text-chrome-text-2 uppercase">{g.label}</p> : null}
                {g.items.map((i) => {
                  const Icon = NAV_ICONS[i.icon] ?? Search;
                  return (
                    <Link
                      key={i.key}
                      href={i.href}
                      onClick={() => setMobileOpen(false)}
                      className="flex h-11 items-center gap-3 rounded-md px-2 text-[15px] hover:bg-chrome-2 hover:text-white"
                    >
                      <Icon className="size-4" /> {i.label}
                      {i.status === "planned" ? <span className="ml-auto text-[10px] text-chrome-text-2 uppercase">Soon</span> : null}
                    </Link>
                  );
                })}
              </div>
            ))}
          </D.Content>
        </D.Portal>
      </D.Root>
    </header>
  );
}
