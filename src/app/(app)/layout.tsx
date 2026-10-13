import type { ReactNode } from "react";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Sidebar } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/topbar";
import type { CreateAction } from "@/components/shell/command-palette";
import { requireContext } from "@/server/auth/context";
import { withScope } from "@/server/db/client";
import { notifications } from "@/server/db/schema";
import { NAV, type NavGroup } from "@/lib/navigation";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireContext();
  const groups: NavGroup[] = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.permission || ctx.permissions.has(i.permission)),
  })).filter((g) => g.items.length > 0);

  const createActions: CreateAction[] = [
    ctx.permissions.has("lead:write") && { label: "New lead", href: "/leads/new" },
    ctx.permissions.has("account:write") && { label: "New account", href: "/accounts/new" },
    ctx.permissions.has("contact:write") && { label: "New contact", href: "/contacts/new" },
    ctx.permissions.has("opportunity:write") && { label: "New opportunity", href: "/opportunities/new" },
    ctx.permissions.has("import:run") && { label: "Import data", href: "/imports/new" },
  ].filter((a): a is CreateAction => Boolean(a));

  const [unread] = await withScope(ctx, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt))),
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar groups={groups} tenantName={ctx.tenant.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={ctx.user} roleName={ctx.roleName} groups={groups} createActions={createActions} unread={unread?.n ?? 0} />
        <main className="min-h-0 flex-1 overflow-y-auto" id="main">
          {children}
        </main>
      </div>
    </div>
  );
}
