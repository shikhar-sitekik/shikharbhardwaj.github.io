"use client";

import { useActionState, useState } from "react";
import { Merge } from "lucide-react";
import { mergeLeadAction } from "@/server/actions/crm";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormMessage, SubmitButton } from "@/components/ui/submit";

export interface MergeCandidate {
  id: string;
  label: string;
  values: Record<string, string | null>;
}

const FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  jobTitle: "Job title",
  company: "Company",
  website: "Website",
  industry: "Industry",
  country: "Country",
  source: "Source",
  productInterest: "Product interest",
  businessProblem: "Business problem",
};

export function MergeLeadDialog({ targetId, target, candidates }: { targetId: string; target: Record<string, string | null>; candidates: MergeCandidate[] }) {
  const [state, action] = useActionState(mergeLeadAction.bind(null, targetId), { status: "idle" });
  const [sourceId, setSourceId] = useState(candidates[0]?.id ?? "");
  const source = candidates.find((c) => c.id === sourceId);
  if (candidates.length === 0) return null;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Merge /> Merge duplicate
        </Button>
      </DialogTrigger>
      <DialogContent title="Merge duplicate lead" description="Choose which value to keep for each field. The duplicate is archived and its activities move to this lead." className="max-w-2xl">
        <form action={action} className="grid gap-3 p-4">
          <FormMessage state={state} />
          <label className="grid gap-1 text-[12px] font-medium text-text-2">
            Duplicate to merge into this lead
            <select name="sourceId" value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="h-8 rounded-md border border-border bg-surface px-2 text-[13px]">
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <div key={sourceId} className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-[12.5px]">
              <thead className="bg-surface-2 text-text-3">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">Field</th>
                  <th className="px-3 py-1.5 text-left font-medium">Keep this lead</th>
                  <th className="px-3 py-1.5 text-left font-medium">Use duplicate</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(FIELD_LABELS).map(([k, label]) => {
                  const a = target[k] ?? null;
                  const b = source?.values[k] ?? null;
                  if (!a && !b) return null;
                  const differs = a !== b;
                  return (
                    <tr key={k} className="border-t border-border">
                      <td className="px-3 py-1.5 text-text-3">{label}</td>
                      <td className="px-3 py-1.5">
                        <label className="flex items-center gap-2">
                          <input type="radio" name={`choice_${k}`} value="target" defaultChecked={!!a || !b} disabled={!differs} className="accent-[var(--accent)]" />
                          <span className="truncate">{a ?? "—"}</span>
                        </label>
                      </td>
                      <td className="px-3 py-1.5">
                        <label className="flex items-center gap-2">
                          <input type="radio" name={`choice_${k}`} value="source" defaultChecked={!a && !!b} disabled={!differs} className="accent-[var(--accent)]" />
                          <span className="truncate">{b ?? "—"}</span>
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <SubmitButton variant="primary" pendingLabel="Merging…">
              Merge
            </SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
