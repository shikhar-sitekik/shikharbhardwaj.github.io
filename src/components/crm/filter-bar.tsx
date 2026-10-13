"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Select } from "@/components/ui/input";
import { cn } from "@/lib/cn";

export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

/** URL-driven filters: every view is shareable and back-button friendly. */
export function FilterBar({
  filters,
  searchPlaceholder = "Search…",
  search = true,
  children,
}: {
  filters: FilterDef[];
  searchPlaceholder?: string;
  search?: boolean;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [pending, start] = useTransition();

  const push = (next: URLSearchParams) => {
    next.delete("page");
    const s = next.toString();
    start(() => router.replace(s ? `${pathname}?${s}` : pathname));
  };

  useEffect(() => {
    const current = params.get("q") ?? "";
    if (q === current) return;
    const t = window.setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (q.trim()) next.set("q", q.trim());
      else next.delete("q");
      push(next);
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on query text change
  }, [q]);

  const active = filters.some((f) => params.get(f.key)) || !!params.get("q");

  return (
    <div className={cn("flex flex-wrap items-center gap-2 border-b border-border px-4 py-2", pending && "opacity-70")}>
      {search ? (
      <div className="relative w-full max-w-[260px]">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-3" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label="Search"
          className="h-8 w-full rounded-md border border-border bg-surface pr-2 pl-8 text-[13px] placeholder:text-text-3 focus:border-accent focus:outline-none"
        />
      </div>
      ) : null}
      {filters.map((f) => (
        <Select
          key={f.key}
          aria-label={f.label}
          className="h-8 w-auto min-w-[130px]"
          value={params.get(f.key) ?? ""}
          onChange={(e) => {
            const next = new URLSearchParams(params.toString());
            if (e.target.value) next.set(f.key, e.target.value);
            else next.delete(f.key);
            push(next);
          }}
        >
          <option value="">{f.label}</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ))}
      {active ? (
        <button
          type="button"
          onClick={() => {
            setQ("");
            const next = new URLSearchParams();
            const view = params.get("view");
            if (view) next.set("view", view);
            push(next);
          }}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-text-3 hover:bg-surface-hover hover:text-text"
        >
          <X className="size-3" /> Clear
        </button>
      ) : null}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}
