import type { Permission } from "@/server/auth/permissions";

export type ModuleStatus = "available" | "planned";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: string;
  permission?: Permission;
  status: ModuleStatus;
  /** Delivery phase for planned modules (see PROJECT_PLAN.md). */
  phase?: number;
  description?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Single source of truth for navigation. Planned modules are shown, clearly
 * labelled, so the product structure is coherent; they never render mock data.
 */
export const NAV: NavGroup[] = [
  {
    label: "",
    items: [
      { key: "home", label: "Home", href: "/", icon: "home", status: "available" },
      { key: "leads", label: "Leads", href: "/leads", icon: "inbox", permission: "lead:read", status: "available" },
      { key: "contacts", label: "Contacts", href: "/contacts", icon: "users", permission: "contact:read", status: "available" },
      { key: "accounts", label: "Companies", href: "/accounts", icon: "building", permission: "account:read", status: "available" },
      { key: "opportunities", label: "Deals", href: "/opportunities", icon: "kanban", permission: "opportunity:read", status: "available" },
      { key: "tasks", label: "Tasks", href: "/tasks", icon: "check-square", permission: "activity:read", status: "available" },
    ],
  },
  {
    label: "Insights",
    items: [
      { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: "gauge", permission: "report:read", status: "available" },
      { key: "reports", label: "Reports", href: "/reports", icon: "bar-chart", permission: "report:read", status: "available" },
    ],
  },
  {
    label: "Settings",
    items: [
      { key: "imports", label: "Upload Excel", href: "/imports", icon: "upload", permission: "import:run", status: "available" },
      { key: "integrations", label: "Integrations", href: "/integrations", icon: "plug", permission: "admin:settings", status: "available" },
      { key: "settings", label: "Team & settings", href: "/settings", icon: "settings", status: "available" },
    ],
  },
  /*
   * Planned modules: designed but not built. Hidden from navigation so the
   * product stays simple; their pages exist at /modules/<key> with an honest
   * "not available yet" notice. See PROJECT_PLAN.md.
   */
  {
    label: "Planned",
    items: [
      { key: "engagement", label: "Sales engagement", href: "/modules/engagement", icon: "send", status: "planned", phase: 4, description: "Sequences, templates and outreach via Microsoft 365 and Google Workspace." },
      { key: "proposals", label: "Proposals & quotes", href: "/modules/proposals", icon: "file-text", status: "planned", phase: 3, description: "Templated proposals with versioning and approval workflows." },
      { key: "products", label: "Products & services", href: "/modules/products", icon: "package", status: "planned", phase: 3, description: "Offering catalogue with versioned price books." },
      { key: "campaigns", label: "Campaigns", href: "/modules/campaigns", icon: "megaphone", status: "planned", phase: 3, description: "Campaigns, budgets, UTM management and attribution." },
      { key: "partners", label: "Partners", href: "/modules/partners", icon: "handshake", status: "planned", phase: 3, description: "Partner directory, deal registration and co-sell pipeline." },
      { key: "presales", label: "Presales & PoC", href: "/modules/presales", icon: "flask", status: "planned", phase: 6, description: "Discovery, solution design and proof-of-concept tracking." },
      { key: "customers", label: "Customers & renewals", href: "/modules/renewals", icon: "repeat", status: "planned", phase: 3, description: "Contracts, renewal calendar and expansion pipeline." },
      { key: "projects", label: "Projects & delivery", href: "/modules/projects", icon: "list-checks", status: "planned", phase: 6, description: "Handover, milestones and go-live tracking for won deals." },
      { key: "ai", label: "AI workspace", href: "/modules/ai", icon: "sparkles", status: "planned", phase: 5, description: "Permission-aware search, account briefs and drafting, with human approval." },
      { key: "documents", label: "Documents", href: "/modules/documents", icon: "folder", status: "planned", phase: 6, description: "Secure document library linked to records." },
      { key: "automation", label: "Automation", href: "/modules/automation", icon: "workflow", status: "planned", phase: 5, description: "Trigger → condition → action workflows with dry runs and history." },
    ],
  },
];

export function findModule(key: string): NavItem | undefined {
  return NAV.flatMap((g) => g.items).find((i) => i.key === key);
}
