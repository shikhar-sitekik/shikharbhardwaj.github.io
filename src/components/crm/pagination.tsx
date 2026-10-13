import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatNumber } from "@/lib/format";

export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[12px] text-text-3">
      <span className="tabular">
        {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
      </span>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={href(page - 1)} className="rounded p-1 hover:bg-surface-hover" aria-label="Previous page">
            <ChevronLeft className="size-4" />
          </Link>
        ) : (
          <span className="p-1 opacity-40">
            <ChevronLeft className="size-4" />
          </span>
        )}
        <span className="tabular px-1">
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <Link href={href(page + 1)} className="rounded p-1 hover:bg-surface-hover" aria-label="Next page">
            <ChevronRight className="size-4" />
          </Link>
        ) : (
          <span className="p-1 opacity-40">
            <ChevronRight className="size-4" />
          </span>
        )}
      </div>
    </div>
  );
}
