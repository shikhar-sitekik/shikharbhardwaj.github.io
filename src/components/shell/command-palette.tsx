"use client";

import { Command } from "cmdk";
import { Building2, CornerDownLeft, Inbox, KanbanSquare, Loader2, Plus, Search, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as D from "@radix-ui/react-dialog";
import type { NavItem } from "@/lib/navigation";
import { NAV_ICONS } from "./icons";

interface Hit {
  entity: "lead" | "account" | "contact" | "opportunity";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

const ENTITY_ICON = { lead: Inbox, account: Building2, contact: User, opportunity: KanbanSquare } as const;
const ENTITY_LABEL = { lead: "Lead", account: "Account", contact: "Contact", opportunity: "Opportunity" } as const;

export interface CreateAction {
  label: string;
  href: string;
}

export function CommandPalette({
  open,
  onOpenChange,
  navItems,
  createActions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  navItems: NavItem[];
  createActions: CreateAction[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setQuery("");
      setHits([]);
    }
    onOpenChange(next);
  };

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const handle = window.setTimeout(async () => {
      setLoading(true);
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.ok) {
          const body = (await res.json()) as { hits: Hit[] };
          setHits(body.hits);
        }
      } catch {
        /* aborted or offline */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => window.clearTimeout(handle);
  }, [query]);

  const shortQuery = query.trim().length < 2;
  const shownHits = shortQuery ? [] : hits;
  const go = useCallback(
    (href: string) => {
      setQuery("");
      setHits([]);
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router],
  );

  return (
    <D.Root open={open} onOpenChange={handleOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-[#0b1426]/45" />
        <D.Content
          className="fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-32px)] max-w-[620px] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-surface shadow-[0_24px_64px_-16px_rgba(11,20,38,0.45)]"
          aria-describedby={undefined}
        >
          <D.Title className="sr-only">Search and commands</D.Title>
          <Command shouldFilter={false} loop label="Search and commands">
            <div className="flex items-center gap-2 border-b border-border px-3.5">
              {loading && !shortQuery ? <Loader2 className="size-4 animate-spin text-text-3" /> : <Search className="size-4 text-text-3" />}
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search records or jump to…"
                className="h-12 flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-text-3"
              />
              <kbd className="rounded border border-border px-1.5 text-[11px] text-text-3">Esc</kbd>
            </div>
            <Command.List className="max-h-[56vh] overflow-y-auto p-1.5">
              {!shortQuery && !loading && shownHits.length === 0 ? (
                <Command.Empty className="px-3 py-6 text-center text-[13px] text-text-3">No records match “{query}”.</Command.Empty>
              ) : null}
              {shownHits.length > 0 ? (
                <Group heading="Records">
                  {shownHits.map((h) => {
                    const Icon = ENTITY_ICON[h.entity];
                    return (
                      <Item key={`${h.entity}-${h.id}`} value={`${h.entity}-${h.id}`} onSelect={() => go(h.href)}>
                        <Icon className="size-4 text-text-3" />
                        <span className="truncate font-medium">{h.title}</span>
                        {h.subtitle ? <span className="truncate text-text-3">{h.subtitle}</span> : null}
                        <span className="ml-auto text-[11px] text-text-3">{ENTITY_LABEL[h.entity]}</span>
                      </Item>
                    );
                  })}
                </Group>
              ) : null}
              {query.trim().length < 2 ? (
                <>
                  <Group heading="Create">
                    {createActions.map((a) => (
                      <Item key={a.href} value={`create-${a.href}`} onSelect={() => go(a.href)}>
                        <Plus className="size-4 text-text-3" />
                        {a.label}
                      </Item>
                    ))}
                  </Group>
                  <Group heading="Go to">
                    {navItems
                      .filter((n) => n.status === "available")
                      .map((n) => {
                        const Icon = NAV_ICONS[n.icon] ?? Search;
                        return (
                          <Item key={n.key} value={`nav-${n.key}`} onSelect={() => go(n.href)}>
                            <Icon className="size-4 text-text-3" />
                            {n.label}
                          </Item>
                        );
                      })}
                  </Group>
                </>
              ) : null}
            </Command.List>
            <div className="flex items-center gap-3 border-t border-border px-3.5 py-2 text-[11px] text-text-3">
              <span className="flex items-center gap-1">
                <CornerDownLeft className="size-3" /> open
              </span>
              <span>↑↓ navigate</span>
              <span className="ml-auto">Results respect your access permissions</span>
            </div>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-3"
    >
      {children}
    </Command.Group>
  );
}

function Item({ children, value, onSelect }: { children: ReactNode; value: string; onSelect: () => void }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-9 cursor-default items-center gap-2.5 rounded-md px-2 text-[13px] text-text data-[selected=true]:bg-surface-hover"
    >
      {children}
    </Command.Item>
  );
}
