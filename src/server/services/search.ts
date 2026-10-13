import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { withScope } from "@/server/db/client";
import { accounts, contacts, leads, opportunities, recentViews } from "@/server/db/schema";
import type { TenantContext } from "@/server/auth/context";
import { likeTerm, ownerScope } from "./_shared";

export type SearchEntity = "lead" | "account" | "contact" | "opportunity";

export interface SearchHit {
  entity: SearchEntity;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  rank: number;
}

const HREF: Record<SearchEntity, (id: string) => string> = {
  lead: (id) => `/leads/${id}`,
  account: (id) => `/accounts/${id}`,
  contact: (id) => `/contacts/${id}`,
  opportunity: (id) => `/opportunities/${id}`,
};

/**
 * Global search across the entities the caller can read, with trigram
 * similarity ranking (pg_trgm GIN indexes, see migration 0001).
 */
export async function globalSearch(ctx: TenantContext, rawQuery: string, limitPerEntity = 6): Promise<SearchHit[]> {
  const q = rawQuery.trim().slice(0, 100);
  if (q.length < 2) return [];
  const term = likeTerm(q);
  const limit = Math.min(Math.max(limitPerEntity, 1), 20);
  return withScope(ctx, async (tx) => {
    const hits: SearchHit[] = [];
    if (ctx.permissions.has("lead:read")) {
      const hay = sql`(coalesce(${leads.firstName},'') || ' ' || ${leads.lastName} || ' ' || coalesce(${leads.company},'') || ' ' || coalesce(${leads.email},''))`;
      const rows = await tx
        .select({ id: leads.id, first: leads.firstName, last: leads.lastName, company: leads.company, rank: sql<number>`similarity(${hay}, ${q})` })
        .from(leads)
        .where(and(isNull(leads.archivedAt), isNull(leads.convertedAt), ownerScope(ctx, leads.ownerId), sql`${hay} ilike ${term}`))
        .orderBy(desc(sql`similarity(${hay}, ${q})`))
        .limit(limit);
      for (const r of rows)
        hits.push({ entity: "lead", id: r.id, title: [r.first, r.last].filter(Boolean).join(" "), subtitle: r.company, href: HREF.lead(r.id), rank: r.rank });
    }
    if (ctx.permissions.has("account:read")) {
      const hay = sql`(${accounts.name} || ' ' || coalesce(${accounts.domain},''))`;
      const rows = await tx
        .select({ id: accounts.id, name: accounts.name, domain: accounts.domain, rank: sql<number>`similarity(${hay}, ${q})` })
        .from(accounts)
        .where(and(isNull(accounts.archivedAt), ownerScope(ctx, accounts.ownerId), sql`${hay} ilike ${term}`))
        .orderBy(desc(sql`similarity(${hay}, ${q})`))
        .limit(limit);
      for (const r of rows)
        hits.push({ entity: "account", id: r.id, title: r.name, subtitle: r.domain, href: HREF.account(r.id), rank: r.rank + 0.05 });
    }
    if (ctx.permissions.has("contact:read")) {
      const hay = sql`(coalesce(${contacts.firstName},'') || ' ' || ${contacts.lastName} || ' ' || coalesce(${contacts.email},''))`;
      const rows = await tx
        .select({ id: contacts.id, first: contacts.firstName, last: contacts.lastName, title: contacts.jobTitle, rank: sql<number>`similarity(${hay}, ${q})` })
        .from(contacts)
        .where(and(isNull(contacts.archivedAt), ownerScope(ctx, contacts.ownerId), sql`${hay} ilike ${term}`))
        .orderBy(desc(sql`similarity(${hay}, ${q})`))
        .limit(limit);
      for (const r of rows)
        hits.push({ entity: "contact", id: r.id, title: [r.first, r.last].filter(Boolean).join(" "), subtitle: r.title, href: HREF.contact(r.id), rank: r.rank });
    }
    if (ctx.permissions.has("opportunity:read")) {
      const rows = await tx
        .select({ id: opportunities.id, name: opportunities.name, account: accounts.name, rank: sql<number>`similarity(${opportunities.name}, ${q})` })
        .from(opportunities)
        .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
        .where(and(isNull(opportunities.archivedAt), ownerScope(ctx, opportunities.ownerId), sql`${opportunities.name} ilike ${term}`))
        .orderBy(desc(sql`similarity(${opportunities.name}, ${q})`))
        .limit(limit);
      for (const r of rows)
        hits.push({ entity: "opportunity", id: r.id, title: r.name, subtitle: r.account, href: HREF.opportunity(r.id), rank: r.rank + 0.05 });
    }
    return hits.sort((a, b) => b.rank - a.rank);
  });
}

export async function recordView(ctx: TenantContext, entityType: SearchEntity, entityId: string, label: string): Promise<void> {
  await withScope(ctx, (tx) =>
    tx
      .insert(recentViews)
      .values({ tenantId: ctx.tenantId, userId: ctx.userId, entityType, entityId, label: label.slice(0, 200) })
      .onConflictDoUpdate({
        target: [recentViews.userId, recentViews.entityType, recentViews.entityId],
        set: { viewedAt: sql`now()`, label: label.slice(0, 200) },
      }),
  );
}

export async function recentlyViewed(ctx: TenantContext, limit = 8) {
  return withScope(ctx, async (tx) => {
    const rows = await tx
      .select()
      .from(recentViews)
      .where(eq(recentViews.userId, ctx.userId))
      .orderBy(desc(recentViews.viewedAt))
      .limit(limit);
    return rows.map((r) => ({
      entityType: r.entityType as SearchEntity,
      entityId: r.entityId,
      label: r.label,
      viewedAt: r.viewedAt,
      href: HREF[r.entityType as SearchEntity]?.(r.entityId) ?? "/",
    }));
  });
}
