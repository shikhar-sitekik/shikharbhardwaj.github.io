import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/context";
import { accountOptions, getContact } from "@/server/services/accounts";
import { memberOptions } from "@/server/services/opportunities";
import { loadOr404 } from "@/server/lib/page";
import { PageHeader } from "@/components/ui/page-header";
import { ContactForm } from "@/components/crm/contact-form";
import { personName } from "@/lib/format";

export const metadata = { title: "Edit contact" };

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  if (!ctx.permissions.has("contact:write")) notFound();
  const { id } = await params;
  const { contact } = await loadOr404(() => getContact(ctx, id));
  const [owners, accounts] = await Promise.all([memberOptions(ctx), accountOptions(ctx)]);
  const name = personName(contact.firstName, contact.lastName);
  return (
    <div>
      <PageHeader title={`Edit ${name}`} crumbs={[{ label: "Contacts", href: "/contacts" }, { label: name, href: `/contacts/${id}` }, { label: "Edit" }]} />
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <ContactForm contactId={id} values={contact} owners={owners} accounts={accounts} />
      </div>
    </div>
  );
}
