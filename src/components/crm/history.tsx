import { History } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/format";

interface Entry {
  id: string;
  action: string;
  changes: Record<string, unknown>;
  createdAt: Date;
  actorName: string | null;
}

function describeChanges(changes: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(changes)) {
    if (v && typeof v === "object" && "from" in v && "to" in v) {
      const c = v as { from: unknown; to: unknown };
      const fmt = (x: unknown) => (x === null || x === "" ? "∅" : typeof x === "object" ? JSON.stringify(x) : String(x));
      out.push(`${k}: ${fmt(c.from)} → ${fmt(c.to)}`);
    }
  }
  return out.slice(0, 8);
}

export function RecordHistory({ entries, timeZone }: { entries: Entry[]; timeZone: string }) {
  if (entries.length === 0) return <EmptyState icon={History} title="No history" />;
  return (
    <ul className="divide-y divide-border">
      {entries.map((e) => {
        const lines = describeChanges(e.changes);
        return (
          <li key={e.id} className="px-4 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[12px] text-text">{e.action}</p>
              <p className="text-[11.5px] text-text-3">
                {e.actorName ?? "System"} · {formatDate(e.createdAt, { withTime: true, timeZone })}
              </p>
            </div>
            {lines.length ? (
              <ul className="mt-1 space-y-0.5">
                {lines.map((l) => (
                  <li key={l} className="truncate font-mono text-[11.5px] text-text-3">
                    {l}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
