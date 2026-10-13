import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/context";
import { listMembers, listRoles, listTeams } from "@/server/services/admin";
import { addMemberAction, createTeamAction, updateMemberAction } from "@/server/actions/admin";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionForm } from "@/components/crm/action-form";
import { SettingsNav } from "@/components/crm/settings-nav";

export const metadata = { title: "Users & teams" };

export default async function UsersPage() {
  const ctx = await requireContext();
  if (!ctx.permissions.has("admin:users")) notFound();
  const [members, roles, teams] = await Promise.all([listMembers(ctx), listRoles(ctx), listTeams(ctx)]);
  return (
    <div>
      <PageHeader title="Administration" description="Manage who can access this workspace and what they can do." />
      <SettingsNav active="/settings/users" permissions={ctx.permissions} />
      <div className="grid gap-4 p-4 md:p-6">
        <Card>
          <CardHeader title="Members" description={`${members.length} member${members.length === 1 ? "" : "s"}. Role changes apply on the member's next request; suspension signs them out everywhere.`} />
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Role</TH>
                <TH>Team</TH>
                <TH>Status</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {members.map((m) => (
                <TR key={m.membershipId}>
                  <TD>
                    <p className="font-medium">
                      {m.name} {m.userId === ctx.userId ? <span className="text-[11.5px] font-normal text-text-3">(you)</span> : null}
                    </p>
                    <p className="text-[12px] text-text-3">{m.email}</p>
                  </TD>
                  <TD colSpan={4}>
                    <ActionForm action={updateMemberAction.bind(null, m.membershipId)} className="flex flex-wrap items-center gap-2">
                      <Select name="roleId" defaultValue={m.roleId} className="h-7 w-auto" aria-label="Role" disabled={m.userId === ctx.userId}>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </Select>
                      <Select name="teamId" defaultValue={m.teamId ?? ""} className="h-7 w-auto" aria-label="Team">
                        <option value="">No team</option>
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </Select>
                      <Select name="status" defaultValue={m.status} className="h-7 w-auto" aria-label="Status" disabled={m.userId === ctx.userId}>
                        <option value="active">Active</option>
                        <option value="suspended">Suspended</option>
                      </Select>
                      {m.status !== "active" ? <Badge tone="danger">{m.status}</Badge> : null}
                      <SubmitButton size="sm" variant="secondary" className="ml-auto">
                        Save
                      </SubmitButton>
                    </ActionForm>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <Card>
            <CardHeader title="Add a member" description="Email invitations need an email provider (see Integrations). Until then, set an initial password and share it securely." />
            <CardBody>
              <ActionForm action={addMemberAction} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
                <Field label="Full name" htmlFor="m-name">
                  <Input id="m-name" name="name" required />
                </Field>
                <Field label="Work email" htmlFor="m-email">
                  <Input id="m-email" name="email" type="email" required />
                </Field>
                <Field label="Role" htmlFor="m-role">
                  <Select id="m-role" name="roleId" defaultValue={roles.find((r) => r.key === "sales_rep")?.id}>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Team" htmlFor="m-team">
                  <Select id="m-team" name="teamId" defaultValue="">
                    <option value="">No team</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Initial password" htmlFor="m-pass" hint="12+ characters. Ignored if the person already has an account." className="sm:col-span-2">
                  <Input id="m-pass" name="password" type="password" autoComplete="new-password" minLength={12} />
                </Field>
                <div className="flex justify-end sm:col-span-2">
                  <SubmitButton>Add member</SubmitButton>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Teams" description="Team-scoped roles see records owned by their team." />
            <ul className="divide-y divide-border">
              {teams.length === 0 ? <li className="px-4 py-2 text-[12.5px] text-text-3">No teams yet.</li> : null}
              {teams.map((t) => (
                <li key={t.id} className="flex items-center justify-between px-4 py-2 text-[13px]">
                  {t.name}
                  <span className="text-[12px] text-text-3">{members.filter((m) => m.teamId === t.id).length} members</span>
                </li>
              ))}
            </ul>
            <ActionForm action={createTeamAction} resetOnSuccess className="flex gap-2 border-t border-border px-4 py-2.5">
              <Input name="name" placeholder="New team name" aria-label="New team name" required className="h-7" />
              <SubmitButton size="sm" variant="secondary">
                Add
              </SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </div>
  );
}
