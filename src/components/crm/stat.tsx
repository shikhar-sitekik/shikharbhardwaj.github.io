import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Stat({
  label,
  value,
  hint,
  href,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  tone?: "neutral" | "danger" | "accent";
}) {
  const inner = (
    <>
      <p className="text-[11.5px] font-medium text-text-3">{label}</p>
      <p
        className={cn(
          "tabular mt-1 text-[22px] leading-none font-semibold tracking-[-0.02em]",
          tone === "danger" ? "text-danger" : tone === "accent" ? "text-accent" : "text-text",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-[11.5px] text-text-3">{hint}</p> : null}
    </>
  );
  const cls = "block rounded-lg border border-border bg-surface px-4 py-3";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-border-strong")}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
