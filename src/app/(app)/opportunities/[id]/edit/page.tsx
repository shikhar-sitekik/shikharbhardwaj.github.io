import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/context";
import { accountOptions, contactOptions } from "@/server/services/accounts";
import { getOpportunity, listPipelines, memberOptions } from "@/server/services/opportunities";
import { CURRENCIES } from "@/server/domain/normalize";
import { loadOr404 } from "@/server/lib/page";
import { PageHeader } from "@/components/ui/page-header";
import { OpportunityForm } from "@/components/crm/opportunity-form";

export const metadata = { title: "Edit opportunity" };

export default async function EditOpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.permissions.has("opportunity:write")) notFound();
  const { id } = await params;
  const { opportunity } = await loadOr404(() => getOpportunity(ctx, id));
  const [accounts, contacts, owners, pipelines] = await Promise.all([accountOptions(ctx), contactOptions(ctx), memberOptions(ctx), listPipelines(ctx)]);
  return (
    <div>
      <PageHeader
        title={`Edit ${opportunity.name}`}
        crumbs={[{ label: "Opportunities", href: "/opportunities" }, { label: opportunity.name, href: `/opportunities/${id}` }, { label: "Edit" }]}
      />
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <OpportunityForm opportunityId={id} values={opportunity} accounts={accounts} contacts={contacts} owners={owners} pipelines={pipelines} currencies={CURRENCIES} />
      </div>
    </div>
  );
}
