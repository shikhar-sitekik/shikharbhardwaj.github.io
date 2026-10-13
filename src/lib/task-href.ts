/** Link to the most specific record a task is attached to. */
export function taskHref(t: { opportunityId: string | null; contactId: string | null; accountId: string | null; leadId: string | null }): string | null {
  if (t.opportunityId) return `/opportunities/${t.opportunityId}`;
  if (t.contactId) return `/contacts/${t.contactId}`;
  if (t.accountId) return `/accounts/${t.accountId}`;
  if (t.leadId) return `/leads/${t.leadId}`;
  return null;
}
