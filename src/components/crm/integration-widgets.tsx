"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { createFormConnectionAction, rotateSecretAction, type SecretResult } from "@/server/actions/integrations";
import { Field, Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit";

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        window.setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check /> : <Copy />} {label}
    </Button>
  );
}

export function SecretReveal({ endpoint, secret }: { endpoint: string; secret: string }) {
  const sample = `BODY='{"event_id":"form-123","first_name":"Ana","last_name":"Lopez","email":"ana@example.com","company":"Acme","message":"We need help with IVR"}'
T=$(date +%s)
SIG=$(printf '%s.%s' "$T" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -H "X-Exato-Signature: t=$T,v1=$SIG" \\
  -d "$BODY"`;
  return (
    <div className="grid gap-2 rounded-md border border-warning/40 bg-warning-soft p-3 text-[12.5px]">
      <p className="font-medium text-warning">Copy this signing secret now. It will not be shown again.</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 font-mono text-[12px]">{secret}</code>
        <CopyButton value={secret} />
      </div>
      <p className="text-text-2">Store it in your website&apos;s server-side configuration (never in browser code). Example request:</p>
      <pre className="overflow-x-auto rounded bg-surface p-2 font-mono text-[11px] leading-relaxed text-text">{sample.replace("$SECRET", "<secret>")}</pre>
    </div>
  );
}

export function NewFormConnection({ endpointBase, owners }: { endpointBase: string; owners: { id: string; name: string }[] }) {
  const [state, action] = useActionState<SecretResult | null, FormData>(createFormConnectionAction, null);
  return (
    <div className="grid gap-3">
      {state?.ok ? <SecretReveal endpoint={`${endpointBase}/${state.id}`} secret={state.secret} /> : null}
      {state && !state.ok ? <p className="text-[12.5px] text-danger">{state.message}</p> : null}
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_160px_auto] sm:items-end">
        <Field label="Form name" htmlFor="fc-name">
          <Input id="fc-name" name="name" placeholder="e.g. Contact us – exato.ai" required />
        </Field>
        <Field label="Assign leads to" htmlFor="fc-owner">
          <Select id="fc-owner" name="defaultOwnerId" defaultValue="">
            <option value="">Assignment rules</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Lead source" htmlFor="fc-source">
          <Select id="fc-source" name="defaultSource" defaultValue="website">
            <option value="website">website</option>
            <option value="webinar">webinar</option>
            <option value="event">event</option>
            <option value="partner">partner</option>
          </Select>
        </Field>
        <SubmitButton>Create endpoint</SubmitButton>
      </form>
    </div>
  );
}

export function RotateSecret({ id, endpoint }: { id: string; endpoint: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  if (result) return <SecretReveal endpoint={endpoint} secret={result} />;
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Rotate the signing secret? Requests signed with the old secret will be rejected immediately.")) return;
        start(async () => {
          const r = await rotateSecretAction(id);
          if (r.ok) setResult(r.secret);
          else toast.error(r.message);
        });
      }}
    >
      <KeyRound /> Rotate secret
    </Button>
  );
}

export { CopyButton };
