import { notFound } from "next/navigation";
import { Globe } from "lucide-react";
import { requireContext } from "@/server/auth/context";
import { listConnections, recentWebhookEvents } from "@/server/services/integrations";
import { memberOptions } from "@/server/services/opportunities";
import { toggleConnectionAction } from "@/server/actions/integrations";
import { PROVIDERS } from "@/server/integrations/registry";
import { env } from "@/server/env";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton, NewFormConnection, RotateSecret } from "@/components/crm/integration-widgets";
import { formatDate, relativeTime } from "@/lib/format";

export const metadata = { title: "Integrations" };

const STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger" }> = {
  configured: { label: "Configured · awaiting first delivery", tone: "accent" },
  authenticated: { label: "Authenticated", tone: "accent" },
  synced: { label: "Initial sync complete", tone: "success" },
  healthy: { label: "Healthy", tone: "success" },
  degraded: { label: "Degraded", tone: "warning" },
  disabled: { label: "Disabled", tone: "neutral" },
};

export default async function IntegrationsPage() {
  const ctx = await requireContext();
  if (!ctx.permissions.has("admin:settings")) notFound();
  const [connections, owners] = await Promise.all([listConnections(ctx), memberOptions(ctx)]);
  const forms = connections.filter((c) => c.provider === "website_forms");
  const events = new Map(await Promise.all(forms.map(async (f) => [f.id, await recentWebhookEvents(ctx, f.id, 5)] as const)));
  const endpointBase = `${env().APP_URL.replace(/\/$/, "")}/api/v1/inbound/forms`;
  const encryptionReady = !!process.env.ENCRYPTION_KEY;
  const planned = PROVIDERS.filter((p) => p.availability === "planned");
  const categories = [...new Set(planned.map((p) => p.category))];
  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Connections are only shown as connected after a verified, successful exchange. Configured, authenticated, synced and healthy are tracked as separate states."
      />
      <div className="grid gap-4 p-4 md:p-6">
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Globe className="size-4 text-text-3" /> Website forms
                <Badge tone="success">Available</Badge>
              </span>
            }
            description="Each endpoint has its own HMAC signing secret (stored encrypted). Submissions create leads, deduplicated by event ID and email, and are rate-limited."
          />
          <CardBody className="grid gap-4">
            {!encryptionReady ? (
              <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">ENCRYPTION_KEY is not configured on the server, so endpoints cannot be created. See README → Environment.</p>
            ) : (
              <NewFormConnection endpointBase={endpointBase} owners={owners} />
            )}
            {forms.length > 0 ? (
              <ul className="divide-y divide-border rounded-md border border-border">
                {forms.map((f) => {
                  const st = STATUS[f.status] ?? { label: f.status, tone: "neutral" as const };
                  const endpoint = `${endpointBase}/${f.id}`;
                  return (
                    <li key={f.id} className="grid gap-2 px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{f.name}</span>
                        <Badge tone={st.tone}>{st.label}</Badge>
                        <span className="text-[12px] text-text-3">
                          {f.receivedCount} received · {f.rejectedCount} rejected · secret {f.secretHint}
                        </span>
                        <div className="ml-auto flex items-center gap-1">
                          <RotateSecret id={f.id} endpoint={endpoint} />
                          <form action={toggleConnectionAction.bind(null, f.id, f.status === "disabled")}>
                            <Button type="submit" size="sm" variant="ghost">
                              {f.status === "disabled" ? "Enable" : "Disable"}
                            </Button>
                          </form>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1 font-mono text-[11.5px]">POST {endpoint}</code>
                        <CopyButton value={endpoint} label="Copy URL" />
                      </div>
                      <p className="text-[12px] text-text-3">
                        Last success: {f.lastSuccessAt ? relativeTime(f.lastSuccessAt) : "never"}
                        {f.lastErrorAt ? ` · last error ${relativeTime(f.lastErrorAt)}: ${f.lastError}` : ""}
                      </p>
                      {(events.get(f.id) ?? []).length > 0 ? (
                        <ul className="grid gap-0.5 font-mono text-[11px] text-text-3">
                          {(events.get(f.id) ?? []).map((e) => (
                            <li key={e.id}>
                              {formatDate(e.receivedAt, { withTime: true, timeZone: ctx.tenant.settings.timezone })} · {e.status}
                              {e.error ? ` · ${e.error}` : ""}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </CardBody>
        </Card>

        {categories.map((cat) => (
          <Card key={cat}>
            <CardHeader title={cat} />
            <ul className="divide-y divide-border">
              {planned
                .filter((p) => p.category === cat)
                .map((p) => (
                  <li key={p.key} className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_auto]">
                    <div>
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {p.name} <Badge>Not built · phase {p.phase}</Badge>
                      </p>
                      <p className="text-[12.5px] text-text-2">{p.description}</p>
                      <p className="mt-1 text-[12px] text-text-3">Requires: {p.prerequisites.join("; ")}.</p>
                    </div>
                    <span className="self-center text-[12px] text-text-3">Not connected</span>
                  </li>
                ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
