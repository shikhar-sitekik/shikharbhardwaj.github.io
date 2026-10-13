import { notFound } from "next/navigation";
import { Clock } from "lucide-react";
import { findModule } from "@/lib/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireContext } from "@/server/auth/context";

const KEY_MAP: Record<string, string> = {
  engagement: "engagement",
  proposals: "proposals",
  products: "products",
  campaigns: "campaigns",
  partners: "partners",
  presales: "presales",
  renewals: "customers",
  projects: "projects",
  ai: "ai",
  documents: "documents",
  automation: "automation",
};

/** Honest placeholder for modules that are designed but not yet built. No mock data. */
export default async function PlannedModulePage({ params }: { params: Promise<{ key: string }> }) {
  await requireContext();
  const { key } = await params;
  const mod = KEY_MAP[key] ? findModule(KEY_MAP[key]) : undefined;
  if (!mod || mod.status !== "planned") notFound();
  return (
    <div>
      <PageHeader title={mod.label} description={mod.description} />
      <div className="p-6">
        <Card>
          <EmptyState
            icon={Clock}
            title="This module is not available yet"
            description={`Planned for delivery phase ${mod.phase}. It will use the same records, permissions and audit trail as the rest of the platform. See PROJECT_PLAN.md for scope.`}
          />
        </Card>
      </div>
    </div>
  );
}
