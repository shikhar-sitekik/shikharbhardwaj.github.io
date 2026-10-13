import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Bell } from "lucide-react";
import { requireContext } from "@/server/auth/context";
import { withScope } from "@/server/db/client";
import { notifications } from "@/server/db/schema";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { relativeTime } from "@/lib/format";
import { markAllReadAction } from "@/server/actions/notifications";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const ctx = await requireContext();
  const rows = await withScope(ctx, (tx) =>
    tx.select().from(notifications).where(eq(notifications.userId, ctx.userId)).orderBy(desc(notifications.createdAt)).limit(100),
  );
  const unread = rows.filter((r) => !r.readAt).length;
  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Assignments, completed imports and other events relevant to you."
        actions={
          unread > 0 ? (
            <form action={markAllReadAction}>
              <Button type="submit">Mark all as read</Button>
            </form>
          ) : null
        }
      />
      <div className="p-6">
        <Card>
          {rows.length === 0 ? (
            <EmptyState icon={Bell} title="You're all caught up" description="Notifications appear here when records are assigned to you or imports finish." />
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((n) => (
                <li key={n.id} className="flex items-start gap-3 px-4 py-3">
                  <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-accent"}`} />
                  <div className="min-w-0 flex-1">
                    {n.href ? (
                      <Link href={n.href} className="font-medium hover:underline">
                        {n.title}
                      </Link>
                    ) : (
                      <p className="font-medium">{n.title}</p>
                    )}
                    {n.body ? <p className="text-[12.5px] text-text-2">{n.body}</p> : null}
                  </div>
                  <span className="shrink-0 text-[12px] text-text-3">{relativeTime(n.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

