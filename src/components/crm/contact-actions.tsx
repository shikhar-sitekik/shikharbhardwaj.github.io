"use client";

import { Mail, MessageCircle, Phone } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { logOutreachAction } from "@/server/actions/crm";
import { cn } from "@/lib/cn";

export interface OutreachTarget {
  name: string;
  email: string | null;
  phone: string | null;
  doNotContact: boolean;
  leadId?: string;
  contactId?: string;
  accountId?: string | null;
}

type Kind = "call" | "email" | "whatsapp";

/**
 * One-tap Call / Email / WhatsApp. Opens the phone dialer, mail app or WhatsApp
 * on the user's device and logs the attempt on the record's timeline.
 */
export function ContactActions({ target, variant = "icon", className }: { target: OutreachTarget; variant?: "icon" | "full"; className?: string }) {
  const router = useRouter();
  const digits = target.phone?.replace(/[^\d]/g, "") ?? "";
  const items: { kind: Kind; label: string; href: string | null; Icon: typeof Phone }[] = [
    { kind: "call", label: "Call", href: target.phone ? `tel:${target.phone}` : null, Icon: Phone },
    { kind: "email", label: "Email", href: target.email ? `mailto:${target.email}` : null, Icon: Mail },
    { kind: "whatsapp", label: "WhatsApp", href: digits.length >= 8 ? `https://wa.me/${digits}` : null, Icon: MessageCircle },
  ];

  // Native links: iOS/Android open the dialer, mail app or WhatsApp themselves.
  // We only log the attempt; the browser handles the hand-off.
  const log = (kind: Kind) => {
    void logOutreachAction({
      kind,
      name: target.name,
      leadId: target.leadId,
      contactId: target.contactId,
      accountId: target.accountId ?? undefined,
    }).then((r) => {
      if (r.status === "error") toast.error(r.message);
      else router.refresh();
    });
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {items.map(({ kind, label, href, Icon }) => {
        const disabled = !href || target.doNotContact;
        const title = !href ? `No ${kind === "email" ? "email" : "phone number"} on file` : target.doNotContact ? "Do not contact" : `${label} ${target.name}`;
        const cls = cn(
          "inline-flex items-center justify-center gap-1.5 rounded-md border border-border text-text-2 transition-colors",
          variant === "icon" ? "size-8" : "h-9 px-3 text-[13px] font-medium",
          disabled ? "cursor-not-allowed opacity-35" : "hover:border-accent hover:bg-accent-soft hover:text-accent",
          !disabled && kind === "whatsapp" && "hover:border-success hover:bg-success-soft hover:text-success",
        );
        const content = (
          <>
            <Icon className="size-4" aria-hidden />
            {variant === "full" ? label : null}
          </>
        );
        if (disabled || !href)
          return (
            <button
              key={kind}
              type="button"
              disabled
              title={title}
              aria-label={title}
              className={cls}
              onClick={() => target.doNotContact && toast.error(`${target.name} is marked “Do not contact”.`)}
            >
              {content}
            </button>
          );
        return (
          <a
            key={kind}
            href={href}
            title={title}
            aria-label={title}
            className={cls}
            {...(kind === "whatsapp" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            onClick={(e) => {
              e.stopPropagation();
              log(kind);
            }}
          >
            {content}
          </a>
        );
      })}
    </div>
  );
}
