import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/context";
import { listRoles } from "@/server/services/admin";
import { updateRoleAction } from "@/server/actions/admin";
import { PERMISSIONS } from "@/server/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit";
import { ActionForm } from "@/components/crm/action-form";
import { SettingsNav } from "@/components/crm/settings-nav";

export const metadata = { title: "Roles & permissions" };

const GROUPS = [...new Set(PERMISSIONS.map((p) => p.split(":")[0]!))];

export default async function RolesPage() {
  const ctx = await requireContext();
  if (!ctx.permissions.has("admin:roles")) notFound();
  const roles = await listRoles(ctx);
  return (
    <div>
      <PageHeader title="Administration" description="Permissions are enforced on the server and in database policies, not just hidden in the interface." />
      <SettingsNav active="/settings/roles" permissions={ctx.permissions} />
      <div className="grid gap-4 p-4 md:p-6">
        {roles.map((r) => {
          const locked = r.key === "tenant_admin";
          return (
            <Card key={r.id}>
              <CardHeader title={r.name} description={r.description ?? undefined} />
              <ActionForm action={updateRoleAction.bind(null, r.id)} className="grid gap-3 px-4 py-3">
                <fieldset disabled={locked} className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
                  {GROUPS.map((g) => (
                    <div key={g}>
                      <p className="mb-1 text-[11.5px] font-semibold text-text-3 uppercase">{g}</p>
                      {PERMISSIONS.filter((p) => p.startsWith(`${g}:`)).map((p) => (
                        <label key={p} className="flex items-center gap-2 text-[12.5px]">
                          <input type="checkbox" name="permissions" value={p} defaultChecked={r.permissions.includes(p)} className="size-3.5 accent-[var(--accent)]" />
                          {p.split(":")[1]}
                        </label>
                      ))}
                    </div>
                  ))}
                </fieldset>
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <label className="flex items-center gap-2 text-[12.5px]">
                    Record access
                    <Select name="dataScope" defaultValue={r.dataScope} className="h-7 w-auto" disabled={locked}>
                      <option value="own">Own records</option>
                      <option value="team">Own + team records</option>
                      <option value="all">All records</option>
                    </Select>
                  </label>
                  {locked ? <span className="text-[12px] text-text-3">The administrator role always has full access.</span> : <SubmitButton size="sm" className="ml-auto">Save role</SubmitButton>}
                </div>
              </ActionForm>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
