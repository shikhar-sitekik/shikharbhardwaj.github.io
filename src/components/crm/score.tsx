import { cn } from "@/lib/cn";

export function ScorePill({ score, thresholds }: { score: number; thresholds: { warm: number; hot: number } }) {
  const band = score >= thresholds.hot ? "hot" : score >= thresholds.warm ? "warm" : "cold";
  return (
    <span
      className={cn(
        "tabular inline-flex min-w-8 items-center justify-center rounded-[4px] px-1.5 text-[11.5px] leading-[18px] font-semibold",
        band === "hot" && "bg-danger-soft text-danger",
        band === "warm" && "bg-warning-soft text-warning",
        band === "cold" && "bg-surface-2 text-text-3 ring-1 ring-border ring-inset",
      )}
      title={`Score ${score} (${band})`}
    >
      {score}
    </span>
  );
}
