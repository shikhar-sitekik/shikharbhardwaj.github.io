import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getAuthState } from "@/server/auth/context";
import { listUserWorkspaces } from "@/server/services/provisioning";
import { logoutAction, selectWorkspaceAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default async function SelectWorkspacePage() {
  const auth = await getAuthState();
  if (!auth) redirect("/login");
  const workspaces = await listUserWorkspaces(auth.userId);
  return (
    <div>
      <h1 className="text-[20px] font-semibold tracking-[-0.015em] text-text">Choose a workspace</h1>
      <p className="mt-1 mb-5 text-[13px] text-text-3">Your account has access to the following workspaces.</p>
      {workspaces.length === 0 ? (
        <EmptyState
          title="No active workspaces"
          description="Your membership may have been suspended. Contact your administrator."
          className="rounded-lg border border-border bg-surface"
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {workspaces.map((w) => (
            <li key={w.tenantId}>
              <form action={selectWorkspaceAction}>
                <input type="hidden" name="tenantId" value={w.tenantId} />
                <button type="submit" className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-surface-hover">
                  <span className="font-medium">{w.name}</span>
                  <ArrowRight className="size-4 text-text-3" aria-hidden />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={logoutAction} className="mt-4">
        <Button type="submit" variant="ghost" size="sm">
          Sign out
        </Button>
      </form>
    </div>
  );
}
