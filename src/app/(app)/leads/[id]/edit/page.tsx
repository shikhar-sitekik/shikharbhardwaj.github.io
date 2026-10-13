import { notFound, redirect } from "next/navigation";
import { requireContext } from "@/server/auth/context";
import { getLead, listLeadStatuses } from "@/server/services/leads";
import { memberOptions } from "@/server/services/opportunities";
import { CURRENCIES } from "@/server/domain/normalize";
import { PageHeader } from "@/components/ui/page-header";
import { LeadForm } from "@/components/crm/lead-form";
import { loadOr404 } from "@/server/lib/page";
import { personName } from "@/lib/format";

export const metadata = { title: "Edit lead" };

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.permissions.has("lead:write")) notFound();
  const { id } = await params;
  const { lead } = await loadOr404(() => getLead(ctx, id));
  if (lead.convertedAt) redirect(`/leads/${id}`);
  const [statuses, owners] = await Promise.all([listLeadStatuses(ctx), memberOptions(ctx)]);
  const name = personName(lead.firstName, lead.lastName);
  return (
    <div>
      <PageHeader title={`Edit ${name}`} crumbs={[{ label: "Leads", href: "/leads" }, { label: name, href: `/leads/${id}` }, { label: "Edit" }]} />
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <LeadForm
          leadId={id}
          values={{ ...lead, website: lead.domain }}
          statuses={statuses.filter((s) => s.category !== "converted")}
          owners={owners}
          currencies={CURRENCIES}
          canAssign={ctx.permissions.has("lead:assign")}
        />
      </div>
    </div>
  );
}
