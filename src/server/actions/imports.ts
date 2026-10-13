"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/permissions";
import { IMPORT_ENTITIES, type ImportEntity } from "@/server/imports/fields";
import { createImportFromFile, rollbackImport, saveMappingAndValidate, startImport } from "@/server/services/imports";
import { runJobs } from "@/server/jobs";
import { logger } from "@/server/lib/logger";
import { runAction, type ActionState } from "./result";

export async function uploadImportAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  let id = "";
  const res = await runAction(async () => {
    const entity = String(fd.get("entity"));
    if (!(IMPORT_ENTITIES as string[]).includes(entity)) throw new ValidationError("Choose what you are importing.");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose a file to upload.");
    const sheet = String(fd.get("sheet") ?? "").trim() || null;
    const job = await createImportFromFile(ctx, {
      entity: entity as ImportEntity,
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      sheet,
    });
    id = job.id;
  });
  if (res.status === "success") redirect(`/imports/${id}`);
  return res;
}

const mappingSchema = z.object({
  duplicateStrategy: z.enum(["skip", "update", "create"]),
  dateOrder: z.enum(["dmy", "mdy"]).default("dmy"),
  pipelineId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
});

export async function validateImportAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const res = await runAction(async () => {
    const mapping: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("map:") && typeof v === "string") mapping[k.slice(4)] = v;
    const opts = mappingSchema.parse(Object.fromEntries(fd));
    const r = await saveMappingAndValidate(ctx, id, mapping, opts.duplicateStrategy, { dateOrder: opts.dateOrder, pipelineId: opts.pipelineId });
    return { message: `${r.valid} of ${r.total} rows are valid${r.invalid ? `, ${r.invalid} have errors` : ""}${r.duplicates ? `; ${r.duplicates} match existing records` : ""}.` };
  });
  revalidatePath(`/imports/${id}`);
  return res;
}

export async function startImportAction(id: string, _prev: ActionState): Promise<ActionState> {
  const ctx = await requireContext();
  const res = await runAction(async () => {
    await startImport(ctx, id);
    // Process in the background right away; the cron worker is the safety net.
    after(async () => {
      try {
        await runJobs({ maxMs: 50_000 });
      } catch (err) {
        logger.error("import.after_failed", { error: err });
      }
    });
    return { message: "Import started." };
  });
  revalidatePath(`/imports/${id}`);
  return res;
}

export async function rollbackImportAction(id: string, _prev: ActionState): Promise<ActionState> {
  const ctx = await requireContext();
  const res = await runAction(async () => {
    const r = await rollbackImport(ctx, id);
    return { message: `Rolled back: ${r.archived} records archived, ${r.restored} restored.` };
  });
  revalidatePath(`/imports/${id}`);
  return res;
}
