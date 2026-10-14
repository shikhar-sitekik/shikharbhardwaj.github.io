import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/context";
import { accountOptions, getAccount } from "@/server/services/accounts";
import { memberOptions } from "@/server/services/opportunities";
import { loadOr404 } from "@/server/lib/page";
import { PageHeader } from "@/components/ui/page-header";
import { AccountForm } from "@/components/crm/account-form";

export const metadata = { title: "Edit company" };

export default async function EditAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.permissions.has("account:write")) notFound();
  const { id } = await params;
  const { account } = await loadOr404(() => getAccount(ctx, id));
  const [owners, parents] = await Promise.all([memberOptions(ctx), accountOptions(ctx)]);
  return (
    <div>
      <PageHeader title={`Edit ${account.name}`} crumbs={[{ label: "Companies", href: "/accounts" }, { label: account.name, href: `/accounts/${id}` }, { label: "Edit" }]} />
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <AccountForm accountId={id} values={{ ...account, website: account.domain }} owners={owners} parents={parents} />
      </div>
    </div>
  );
}
