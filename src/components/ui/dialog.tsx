"use client";

import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  side = "center",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  side?: "center" | "right";
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-[#0b1426]/40 data-[state=open]:animate-[fadeIn_120ms_ease-out]" />
      <D.Content
        className={cn(
          "fixed z-50 flex flex-col border border-border bg-surface shadow-[0_16px_48px_-12px_rgba(11,20,38,0.35)] focus:outline-none",
          side === "center" &&
            "top-[8vh] left-1/2 max-h-[84vh] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 rounded-lg",
          side === "right" && "top-0 right-0 h-full w-full max-w-xl",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <D.Title className="text-[14px] font-semibold text-text">{title}</D.Title>
            {description ? (
              <D.Description className="mt-0.5 text-[12.5px] text-text-3">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{title}</D.Description>
            )}
          </div>
          <D.Close className="rounded p-1 text-text-3 hover:bg-surface-hover hover:text-text" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
