import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {Icon ? (
        <div className="mb-3 flex size-9 items-center justify-center rounded-md border border-border bg-surface-2 text-text-3">
          <Icon className="size-4" aria-hidden />
        </div>
      ) : null}
      <p className="text-[13px] font-medium text-text">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-[12.5px] text-text-3">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
