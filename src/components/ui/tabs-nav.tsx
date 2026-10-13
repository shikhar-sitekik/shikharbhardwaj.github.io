import Link from "next/link";
import { cn } from "@/lib/cn";

/** URL-driven tabs (server-rendered, linkable). */
export function TabsNav({ tabs, active, basePath }: { tabs: { key: string; label: string; count?: number }[]; active: string; basePath: string }) {
  return (
    <nav className="flex gap-4 border-b border-border px-4" aria-label="Sections">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.key === tabs[0]?.key ? basePath : `${basePath}?tab=${t.key}`}
          aria-current={active === t.key ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 py-2 text-[12.5px] font-medium",
            active === t.key ? "border-accent text-text" : "border-transparent text-text-3 hover:text-text",
          )}
        >
          {t.label}
          {t.count !== undefined ? <span className="ml-1 text-text-3">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
