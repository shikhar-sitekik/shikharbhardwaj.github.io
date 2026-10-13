"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { setOpportunityContactAction } from "@/server/actions/crm";
import { Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit";
import { BUYING_ROLE_LABELS } from "@/lib/crm-options";

export function CommitteeForm({ opportunityId, contacts }: { opportunityId: string; contacts: { id: string; name: string }[] }) {
  const [state, action] = useActionState(setOpportunityContactAction.bind(null, opportunityId), { status: "idle" });
  useEffect(() => {
    if (state.status === "success") toast.success(state.message ?? "Saved");
    if (state.status === "error") toast.error(state.message);
  }, [state]);
  if (contacts.length === 0) return <p className="px-4 py-3 text-[12px] text-text-3">Add contacts to the account to build the buying committee.</p>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
      <Select name="contactId" className="h-7 min-w-0 flex-1" aria-label="Contact" required>
        {contacts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Select name="role" className="h-7 w-auto" aria-label="Role" defaultValue="influencer">
        {Object.entries(BUYING_ROLE_LABELS).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
        <option value="remove">— Remove from deal</option>
      </Select>
      <SubmitButton size="sm" variant="secondary">
        Save
      </SubmitButton>
    </form>
  );
}
