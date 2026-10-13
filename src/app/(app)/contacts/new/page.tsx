import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/context";
import { accountOptions } from "@/server/services/accounts";
import { memberOptions } from "@/server/services/opportunities";
import { isUuid, sp } from "@/server/lib/page";
import { PageHeader } from "@/components/ui/page-header";
import { ContactForm } from "@/components/crm/contact-form";

export const metadata = { title: "New contact" };

export default async function NewContactPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  if (!ctx.permissions.has("contact:write")) notFound();
  const accountId = sp(await searchParams, "accountId");
  const [owners, accounts] = await Promise.all([memberOptions(ctx), accountOptions(ctx)]);
  return (
    <div>
      <PageHeader title="New contact" crumbs={[{ label: "Contacts", href: "/contacts" }, { label: "New" }]} />
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <ContactForm contactId={null} values={{ accountId: isUuid(accountId) ? accountId : null }} owners={owners} accounts={accounts} />
      </div>
    </div>
  );
}
