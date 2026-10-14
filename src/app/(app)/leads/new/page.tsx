import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/context";
import { listLeadStatuses } from "@/server/services/leads";
import { memberOptions } from "@/server/services/opportunities";
import { CURRENCIES } from "@/server/domain/normalize";
import { PageHeader } from "@/components/ui/page-header";
import { LeadForm } from "@/components/crm/lead-form";

export const metadata = { title: "New lead" };

export default async function NewLeadPage() {
  const ctx = await requireContext();
  if (!ctx.permissions.has("lead:write")) notFound();
  const [statuses, owners] = await Promise.all([listLeadStatuses(ctx), memberOptions(ctx)]);
  return (
    <div>
      <PageHeader title="Add a lead" crumbs={[{ label: "Leads", href: "/leads" }, { label: "New" }]} />
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <LeadForm
          leadId={null}
          values={{ currency: ctx.tenant.settings.baseCurrency }}
          statuses={statuses.filter((s) => s.category !== "converted")}
          owners={owners}
          currencies={CURRENCIES}
          canAssign={ctx.permissions.has("lead:assign")}
        />
      </div>
    </div>
  );
}
