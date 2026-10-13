import { requireContext } from "@/server/auth/context";
import { listUserSessions } from "@/server/auth/session";
import { changePasswordAction, revokeOtherSessionsAction, revokeSessionAction } from "@/server/actions/admin";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit";
import { Badge } from "@/components/ui/badge";
import { ActionForm } from "@/components/crm/action-form";
import { SettingsNav } from "@/components/crm/settings-nav";
import { FieldList } from "@/components/crm/fields";
import { formatDate, relativeTime } from "@/lib/format";

export const metadata = { title: "Profile & sessions" };

function device(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return [browser, os].filter(Boolean).join(" on ");
}

export default async function ProfilePage() {
  const ctx = await requireContext();
  const sessions = await listUserSessions(ctx.userId);
  return (
    <div>
      <PageHeader title="Administration" />
      <SettingsNav active="/settings/profile" permissions={ctx.permissions} />
      <div className="grid gap-4 p-4 md:p-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" />
          <FieldList items={[["Name", ctx.user.name], ["Email", ctx.user.email], ["Role", ctx.roleName], ["Record access", ctx.dataScope], ["Workspace", ctx.tenant.name]]} />
        </Card>
        <Card>
          <CardHeader title="Change password" description="Changing your password signs out all your other sessions." />
          <ActionForm action={changePasswordAction} resetOnSuccess className="grid gap-3 px-4 py-3">
            <Field label="Current password" htmlFor="current">
              <Input id="current" name="current" type="password" autoComplete="current-password" required />
            </Field>
            <Field label="New password" htmlFor="next" hint="At least 12 characters.">
              <Input id="next" name="next" type="password" autoComplete="new-password" minLength={12} required />
            </Field>
            <div className="flex justify-end">
              <SubmitButton>Change password</SubmitButton>
            </div>
          </ActionForm>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader
            title="Active sessions"
            actions={
              sessions.length > 1 ? (
                <form action={revokeOtherSessionsAction}>
                  <Button type="submit" size="sm">
                    Sign out other sessions
                  </Button>
                </form>
              ) : null
            }
          />
          <ul className="divide-y divide-border">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div>
                  <p className="text-[13px] font-medium">
                    {device(s.userAgent)} {s.id === ctx.sessionId ? <Badge tone="success">This device</Badge> : null}
                  </p>
                  <p className="text-[12px] text-text-3">
                    {s.ipAddress ?? "Unknown IP"} · signed in {formatDate(s.createdAt, { timeZone: ctx.tenant.settings.timezone })} · active {relativeTime(s.lastSeenAt)}
                  </p>
                </div>
                {s.id !== ctx.sessionId ? (
                  <form action={revokeSessionAction.bind(null, s.id)}>
                    <Button type="submit" size="sm" variant="ghost">
                      Sign out
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
