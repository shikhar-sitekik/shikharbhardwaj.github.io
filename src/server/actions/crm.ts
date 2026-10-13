"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/permissions";
import {
  archiveLeads,
  assignLeads,
  convertLead,
  createLead,
  mergeLeads,
  setLeadStatus,
  updateLead,
  MERGEABLE_LEAD_FIELDS,
} from "@/server/services/leads";
import { archiveAccount, archiveContact, createAccount, createContact, updateAccount, updateContact } from "@/server/services/accounts";
import {
  archiveOpportunities,
  createOpportunity,
  moveOpportunityStage,
  setOpportunityContact,
  updateOpportunity,
} from "@/server/services/opportunities";
import { createActivity, setTaskCompleted } from "@/server/services/activities";
import { BUYING_ROLES } from "@/server/validation/crm";
import { formToObject, runAction, type ActionState } from "./result";

const uuid = z.string().uuid();
const ids = (fd: FormData) => fd.getAll("ids").map(String).filter((v) => uuid.safeParse(v).success);

// ─── Leads ──────────────────────────────────────────────────────────────────

export async function saveLeadAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  let target = "";
  const res = await runAction(async () => {
    const data = formToObject(fd);
    const lead = id ? await updateLead(ctx, id, data) : await createLead(ctx, data, { origin: "form" });
    target = `/leads/${lead.id}`;
  });
  if (res.status === "success") {
    revalidatePath("/leads");
    redirect(target);
  }
  return res;
}

export async function bulkLeadAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const res = await runAction(async () => {
    const selected = ids(fd);
    if (selected.length === 0) throw new ValidationError("Select at least one lead.");
    const op = String(fd.get("op"));
    const value = String(fd.get("value") ?? "");
    if (op === "status") {
      const n = await setLeadStatus(ctx, selected, uuid.parse(value));
      return { message: `Updated status on ${n} lead${n === 1 ? "" : "s"}.` };
    }
    if (op === "assign") {
      const n = await assignLeads(ctx, selected, uuid.parse(value));
      return { message: `Reassigned ${n} lead${n === 1 ? "" : "s"}.` };
    }
    if (op === "archive") {
      const n = await archiveLeads(ctx, selected);
      return { message: `Archived ${n} lead${n === 1 ? "" : "s"}.` };
    }
    throw new ValidationError("Unknown bulk action.");
  });
  revalidatePath("/leads");
  return res;
}

export async function convertLeadAction(leadId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  let target = "";
  const res = await runAction(async () => {
    const accountMode = String(fd.get("accountMode") ?? "new");
    const createOpp = fd.get("createOpportunity") === "on";
    const amountRaw = String(fd.get("amount") ?? "").replace(/,/g, "");
    const result = await convertLead(ctx, leadId, {
      accountId: accountMode === "existing" ? uuid.parse(fd.get("accountId")) : null,
      accountName: String(fd.get("accountName") ?? ""),
      contactId: null,
      createOpportunity: createOpp,
      opportunity: createOpp
        ? {
            name: String(fd.get("opportunityName") ?? ""),
            pipelineId: uuid.parse(fd.get("pipelineId")),
            amount: amountRaw ? Number(amountRaw) : null,
            currency: String(fd.get("currency") ?? ctx.tenant.settings.baseCurrency),
            expectedCloseDate: String(fd.get("expectedCloseDate") ?? "") || null,
          }
        : undefined,
    });
    target = result.opportunityId ? `/opportunities/${result.opportunityId}` : `/accounts/${result.accountId}`;
  });
  if (res.status === "success") {
    revalidatePath("/leads");
    redirect(target);
  }
  return res;
}

export async function mergeLeadAction(targetId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const res = await runAction(async () => {
    const sourceId = uuid.parse(fd.get("sourceId"));
    const choices: Partial<Record<(typeof MERGEABLE_LEAD_FIELDS)[number], "target" | "source">> = {};
    for (const f of MERGEABLE_LEAD_FIELDS) {
      const v = fd.get(`choice_${f}`);
      if (v === "source" || v === "target") choices[f] = v;
    }
    await mergeLeads(ctx, targetId, sourceId, choices);
  });
  if (res.status === "success") {
    revalidatePath(`/leads/${targetId}`);
    redirect(`/leads/${targetId}`);
  }
  return res;
}

// ─── Accounts & contacts ────────────────────────────────────────────────────

export async function saveAccountAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  let target = "";
  const res = await runAction(async () => {
    const a = id ? await updateAccount(ctx, id, formToObject(fd)) : await createAccount(ctx, formToObject(fd));
    target = `/accounts/${a.id}`;
  });
  if (res.status === "success") {
    revalidatePath("/accounts");
    redirect(target);
  }
  return res;
}

export async function archiveAccountAction(id: string, _prev: ActionState): Promise<ActionState> {
  const ctx = await requireContext();
  const res = await runAction(() => archiveAccount(ctx, id));
  if (res.status === "success") redirect("/accounts");
  return res;
}

export async function saveContactAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  let target = "";
  const res = await runAction(async () => {
    const c = id ? await updateContact(ctx, id, formToObject(fd)) : await createContact(ctx, formToObject(fd));
    target = `/contacts/${c.id}`;
  });
  if (res.status === "success") {
    revalidatePath("/contacts");
    redirect(target);
  }
  return res;
}

export async function archiveContactAction(id: string, _prev: ActionState): Promise<ActionState> {
  const ctx = await requireContext();
  const res = await runAction(() => archiveContact(ctx, id));
  if (res.status === "success") redirect("/contacts");
  return res;
}

// ─── Opportunities ──────────────────────────────────────────────────────────

export async function saveOpportunityAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  let target = "";
  const res = await runAction(async () => {
    const o = id ? await updateOpportunity(ctx, id, formToObject(fd)) : await createOpportunity(ctx, formToObject(fd));
    target = `/opportunities/${o.id}`;
  });
  if (res.status === "success") {
    revalidatePath("/opportunities");
    redirect(target);
  }
  return res;
}

const moveSchema = z.object({
  opportunityId: uuid,
  stageId: uuid,
  lossReason: z.string().max(500).nullish(),
  amount: z.number().min(0).max(1e13).nullish(),
  expectedCloseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

/** Called from the Kanban board (drag-and-drop) and the stage path. */
export async function moveStageAction(input: z.input<typeof moveSchema>): Promise<ActionState> {
  const ctx = await requireContext();
  const res = await runAction(async () => {
    const parsed = moveSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("Invalid stage change.");
    const { opportunityId, ...rest } = parsed.data;
    await moveOpportunityStage(ctx, opportunityId, rest);
  });
  revalidatePath("/opportunities");
  if (typeof input.opportunityId === "string") revalidatePath(`/opportunities/${input.opportunityId}`);
  return res;
}

export async function setOpportunityContactAction(opportunityId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const res = await runAction(async () => {
    const contactId = uuid.parse(fd.get("contactId"));
    const roleRaw = String(fd.get("role") ?? "");
    const role = roleRaw === "remove" ? null : z.enum(BUYING_ROLES).parse(roleRaw);
    await setOpportunityContact(ctx, opportunityId, contactId, role);
    return { message: role ? "Buying committee updated." : "Contact removed." };
  });
  revalidatePath(`/opportunities/${opportunityId}`);
  return res;
}

export async function archiveOpportunityAction(id: string, _prev: ActionState): Promise<ActionState> {
  const ctx = await requireContext();
  const res = await runAction(async () => {
    await archiveOpportunities(ctx, [id]);
  });
  if (res.status === "success") redirect("/opportunities?view=table");
  return res;
}

// ─── Activities ─────────────────────────────────────────────────────────────

export async function logActivityAction(revalidate: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const res = await runAction(async () => {
    const data = formToObject(fd);
    // datetime-local inputs carry no zone: interpret in the browser-supplied offset.
    const offset = Number(fd.get("tzOffset") ?? 0);
    for (const k of ["dueAt", "occurredAt"]) {
      const v = data[k];
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) {
        data[k] = new Date(new Date(`${v}:00Z`).getTime() + offset * 60_000).toISOString();
      }
    }
    await createActivity(ctx, data);
    return { message: data.type === "task" ? "Task created." : "Activity logged." };
  });
  if (revalidate.startsWith("/")) revalidatePath(revalidate);
  return res;
}

export async function toggleTaskAction(id: string, completed: boolean): Promise<ActionState> {
  const ctx = await requireContext();
  const res = await runAction(() => setTaskCompleted(ctx, id, completed));
  revalidatePath("/", "layout");
  return res;
}
