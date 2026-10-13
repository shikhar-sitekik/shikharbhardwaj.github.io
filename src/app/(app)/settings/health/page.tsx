import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { requireContext } from "@/server/auth/context";
import { pingDatabase, withScope } from "@/server/db/client";
import { queueStats } from "@/server/jobs";
import { env } from "@/server/env";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FieldList } from "@/components/crm/fields";
import { SettingsNav } from "@/components/crm/settings-nav";
import { formatDate } from "@/lib/format";

export const metadata = { title: "System health" };

export default async function HealthPage() {
  const ctx = await requireContext();
  if (!ctx.permissions.has("admin:settings")) notFound();
  const { ok: dbOk, latencyMs: latency } = await pingDatabase();
  const stats = await queueStats(ctx.tenantId);
  const [outbox] = await withScope(ctx, (tx) =>
    tx.execute<{ pending: number; oldest: Date | null }>(sql`select count(*)::int as pending, min(occurred_at) as oldest from outbox_events where published_at is null`),
  );
  const imports = await withScope(ctx, (tx) =>
    tx.execute<{ status: string; n: number }>(sql`select status::text, count(*)::int as n from import_jobs where created_at > now() - interval '30 days' group by status`),
  );
  return (
    <div>
      <PageHeader title="Administration" description="Operational status for this workspace. Infrastructure details and secrets are never shown here." />
      <SettingsNav active="/settings/health" permissions={ctx.permissions} />
      <div className="grid gap-4 p-4 md:p-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Platform" />
          <FieldList
            items={[
              ["Database", dbOk ? <Badge tone="success">Reachable · {latency} ms</Badge> : <Badge tone="danger">Unreachable</Badge>],
              ["Version", process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "development build"],
              ["Environment", env().NODE_ENV],
              ["Scheduled worker", env().CRON_SECRET ? <Badge tone="success">Configured</Badge> : <Badge tone="warning">CRON_SECRET not set: background jobs only run after user actions</Badge>],
              ["Self-service sign-up", env().ALLOW_SIGNUP ? "Enabled" : "Disabled"],
              ["Unpublished domain events", `${outbox?.pending ?? 0}${outbox?.oldest ? ` (oldest ${formatDate(outbox.oldest, { withTime: true })})` : ""}`],
            ]}
          />
          <p className="border-t border-border px-4 py-2.5 text-[12px] text-text-3">
            Domain events are recorded in a transactional outbox. Webhook and automation consumers are not yet built, so events accumulate here by design until Phase 5.
          </p>
        </Card>
        <Card>
          <CardHeader title="Background jobs (7 days)" />
          {stats.counts.length === 0 ? (
            <EmptyState title="No jobs have run" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Type</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Count</TH>
                </tr>
              </THead>
              <TBody>
                {stats.counts.map((c) => (
                  <TR key={`${c.type}-${c.status}`}>
                    <TD className="font-mono text-[12px]">{c.type}</TD>
                    <TD>
                      <Badge tone={c.status === "succeeded" ? "success" : c.status === "dead" ? "danger" : c.status === "failed" ? "warning" : "neutral"}>{c.status}</Badge>
                    </TD>
                    <TD className="tabular text-right">{c.n}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {stats.dead.length ? (
            <div className="border-t border-border px-4 py-2.5">
              <p className="mb-1 text-[12px] font-medium text-danger">Dead-lettered jobs</p>
              <ul className="space-y-1 text-[12px]">
                {stats.dead.map((d) => (
                  <li key={d.id} className="font-mono text-text-3">
                    {d.type} · {d.last_error?.slice(0, 120)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
        <Card>
          <CardHeader title="Imports (30 days)" />
          <FieldList items={imports.length ? imports.map((i) => [i.status, String(i.n)] as [string, string]) : [["Imports", "None"]]} />
        </Card>
      </div>
    </div>
  );
}
