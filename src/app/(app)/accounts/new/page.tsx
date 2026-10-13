import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/context";
import { accountOptions } from "@/server/services/accounts";
import { memberOptions } from "@/server/services/opportunities";
import { PageHeader } from "@/components/ui/page-header";
import { AccountForm } from "@/components/crm/account-form";

export const metadata = { title: "New account" };

export default async function NewAccountPage() {
  const ctx = await requireContext();
  if (!ctx.permissions.has("account:write")) notFound();
  const [owners, parents] = await Promise.all([memberOptions(ctx), accountOptions(ctx)]);
  return (
    <div>
      <PageHeader title="New account" crumbs={[{ label: "Accounts", href: "/accounts" }, { label: "New" }]} />
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <AccountForm accountId={null} values={{}} owners={owners} parents={parents} />
      </div>
    </div>
  );
}
