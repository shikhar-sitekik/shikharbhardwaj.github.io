import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/context";
import { accountOptions, contactOptions } from "@/server/services/accounts";
import { listPipelines, memberOptions } from "@/server/services/opportunities";
import { CURRENCIES } from "@/server/domain/normalize";
import { isUuid, sp } from "@/server/lib/page";
import { PageHeader } from "@/components/ui/page-header";
import { OpportunityForm } from "@/components/crm/opportunity-form";

export const metadata = { title: "New deal" };

export default async function NewOpportunityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  if (!ctx.permissions.has("opportunity:write")) notFound();
  const params = await searchParams;
  const [accounts, contacts, owners, pipelines] = await Promise.all([accountOptions(ctx), contactOptions(ctx), memberOptions(ctx), listPipelines(ctx)]);
  const accountId = sp(params, "accountId");
  const pipelineId = sp(params, "pipelineId");
  return (
    <div>
      <PageHeader title="New deal" crumbs={[{ label: "Deals", href: "/opportunities" }, { label: "New" }]} />
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <OpportunityForm
          opportunityId={null}
          values={{
            accountId: isUuid(accountId) ? accountId : null,
            pipelineId: pipelines.find((p) => p.id === pipelineId)?.id,
            currency: ctx.tenant.settings.baseCurrency,
          }}
          accounts={accounts}
          contacts={contacts}
          owners={owners}
          pipelines={pipelines}
          currencies={CURRENCIES}
        />
      </div>
    </div>
  );
}
