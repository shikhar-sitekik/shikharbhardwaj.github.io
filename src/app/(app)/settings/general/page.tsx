import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/context";
import { memberOptions } from "@/server/services/opportunities";
import { updateGeneralSettingsAction, updateScoringAction } from "@/server/actions/admin";
import { CURRENCIES } from "@/server/domain/normalize";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit";
import { ActionForm } from "@/components/crm/action-form";
import { SettingsNav } from "@/components/crm/settings-nav";

export const metadata = { title: "General settings" };

export default async function GeneralSettingsPage() {
  const ctx = await requireContext();
  if (!ctx.permissions.has("admin:settings")) notFound();
  const s = ctx.tenant.settings;
  const members = await memberOptions(ctx);
  const pool = new Set(s.assignment.userIds);
  return (
    <div>
      <PageHeader title="Administration" description="Workspace-wide defaults. Changes are validated and recorded in the audit log." />
      <SettingsNav active="/settings/general" permissions={ctx.permissions} />
      <div className="grid gap-4 p-4 md:p-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Workspace defaults" />
          <ActionForm action={updateGeneralSettingsAction} className="grid gap-3 px-4 py-3 sm:grid-cols-2">
            <Field label="Base (reporting) currency" htmlFor="baseCurrency">
              <Select id="baseCurrency" name="baseCurrency" defaultValue={s.baseCurrency}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Timezone (IANA)" htmlFor="timezone">
              <Input id="timezone" name="timezone" defaultValue={s.timezone} placeholder="Asia/Kolkata" />
            </Field>
            <Field label="Lead follow-up threshold (days)" htmlFor="staleLeadDays">
              <Input id="staleLeadDays" name="staleLeadDays" type="number" min={1} max={365} defaultValue={s.staleLeadDays} />
            </Field>
            <Field label="Stalled deal threshold (days)" htmlFor="staleOpportunityDays">
              <Input id="staleOpportunityDays" name="staleOpportunityDays" type="number" min={1} max={365} defaultValue={s.staleOpportunityDays} />
            </Field>
            <Field label="Warm lead score ≥" htmlFor="warm">
              <Input id="warm" name="warm" type="number" min={0} max={100} defaultValue={s.scoreThresholds.warm} />
            </Field>
            <Field label="Hot lead score ≥" htmlFor="hot">
              <Input id="hot" name="hot" type="number" min={0} max={100} defaultValue={s.scoreThresholds.hot} />
            </Field>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-[12px] font-medium text-text-2">FX rates to {s.baseCurrency} (reporting only)</legend>
              <p className="mb-2 text-[12px] text-text-3">
                1 unit of each currency = N {s.baseCurrency}. Leave blank for currencies you don&apos;t use; deals in currencies without a rate are excluded from totals and flagged. Original deal values are never changed. These are manually maintained rates, not a live feed.
              </p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {CURRENCIES.filter((c) => c !== s.baseCurrency).map((c) => (
                  <label key={c} className="flex items-center gap-1.5 text-[12px]">
                    <span className="w-8 text-text-3">{c}</span>
                    <Input name={`fx:${c}`} inputMode="decimal" defaultValue={s.fxRates[c] ?? ""} className="h-7" />
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-[12px] font-medium text-text-2">Lead assignment</legend>
              <label className="mb-2 flex items-center gap-2 text-[12.5px]">
                <input type="checkbox" name="rrMode" value="round_robin" defaultChecked={s.assignment.mode === "round_robin"} className="accent-[var(--accent)]" />
                Assign new unowned leads round-robin across:
              </label>
              <div className="grid gap-1 sm:grid-cols-2">
                {members.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-[12.5px]">
                    <input type="checkbox" name="rr" value={m.id} defaultChecked={pool.has(m.id)} className="accent-[var(--accent)]" />
                    {m.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex justify-end sm:col-span-2">
              <SubmitButton>Save settings</SubmitButton>
            </div>
          </ActionForm>
        </Card>
        <Card>
          <CardHeader title="Lead scoring rules" description="Deterministic and explainable: a lead's score is the sum of matching rules, capped at 0–100. Saving re-scores all open leads." />
          <ActionForm action={updateScoringAction} className="grid gap-0">
            <ul className="divide-y divide-border">
              {s.scoringRules.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px]">{r.label}</p>
                    <p className="font-mono text-[11px] text-text-3">
                      {r.category} · {r.field} {r.operator}
                      {r.value !== undefined ? ` ${Array.isArray(r.value) ? r.value.join("|") : r.value}` : ""}
                    </p>
                  </div>
                  <Input name={`points:${r.id}`} type="number" min={-100} max={100} defaultValue={r.points} className="h-7 w-20 text-right" aria-label={`Points for ${r.label}`} />
                </li>
              ))}
            </ul>
            <div className="flex justify-end border-t border-border px-4 py-2.5">
              <SubmitButton>Save and re-score</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
