import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { jobs } from "@/server/db/schema";
import { logger } from "@/server/lib/logger";

/*
 * Durable Postgres-backed job queue.
 * - Jobs are claimed with FOR UPDATE SKIP LOCKED (safe with concurrent workers).
 * - Failures retry with exponential backoff; after maxAttempts the job is "dead"
 *   (dead-letter state, visible on the System health page).
 * - Jobs stuck in "running" longer than LOCK_TIMEOUT are reclaimed.
 * - Idempotency keys dedupe enqueues of the same logical job.
 * Workers run from Vercel Cron (/api/cron/jobs) and opportunistically after
 * the request that enqueued them (next/server `after`).
 */

export type JobHandler = (job: { id: string; tenantId: string | null; payload: Record<string, unknown>; attempts: number }) => Promise<"done" | "continue">;

const handlers = new Map<string, JobHandler>();
const LOCK_TIMEOUT_MINUTES = 10;

export function registerJobHandler(type: string, handler: JobHandler): void {
  handlers.set(type, handler);
}

export async function enqueueJob(input: {
  type: string;
  tenantId: string | null;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}): Promise<string | null> {
  const [row] = await db()
    .insert(jobs)
    .values({
      type: input.type,
      tenantId: input.tenantId,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey ?? null,
      runAt: input.runAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? 5,
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id });
  return row?.id ?? null;
}

type ClaimedJob = {
  id: string;
  type: string;
  tenant_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

async function claim(): Promise<ClaimedJob | null> {
  const rows = await db().execute<ClaimedJob>(sql`
    update jobs set status = 'running', locked_at = now(), attempts = attempts + 1
    where id = (
      select id from jobs
      where (status = 'queued' and run_at <= now())
         or (status = 'running' and locked_at < now() - make_interval(mins => ${LOCK_TIMEOUT_MINUTES}))
      order by run_at
      for update skip locked
      limit 1
    )
    returning id, type, tenant_id, payload, attempts, max_attempts`);
  return rows[0] ?? null;
}

async function finish(id: string, outcome: "done" | "continue"): Promise<void> {
  if (outcome === "done") {
    await db().execute(sql`update jobs set status = 'succeeded', finished_at = now(), locked_at = null where id = ${id}`);
  } else {
    // More work remains (chunked job): requeue immediately without counting an attempt.
    await db().execute(sql`update jobs set status = 'queued', locked_at = null, attempts = greatest(attempts - 1, 0), run_at = now() where id = ${id}`);
  }
}

async function fail(job: ClaimedJob, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message.slice(0, 1000) : "Unknown error";
  const dead = job.attempts >= job.max_attempts;
  const backoffSeconds = Math.min(3600, 15 * 2 ** (job.attempts - 1));
  await db().execute(sql`
    update jobs set
      status = ${dead ? "dead" : "queued"},
      last_error = ${message},
      locked_at = null,
      run_at = now() + make_interval(secs => ${backoffSeconds}),
      finished_at = ${dead ? sql`now()` : sql`null`}
    where id = ${job.id}`);
  logger.error("job.failed", { jobId: job.id, type: job.type, attempts: job.attempts, dead, error: err });
}

/** Processes jobs until the queue is empty or the time budget is spent. */
export async function runJobs(opts: { maxMs?: number; maxJobs?: number } = {}): Promise<{ processed: number; failed: number }> {
  const deadline = Date.now() + (opts.maxMs ?? 25_000);
  const maxJobs = opts.maxJobs ?? 200;
  let processed = 0;
  let failed = 0;
  while (Date.now() < deadline && processed + failed < maxJobs) {
    const job = await claim();
    if (!job) break;
    const handler = handlers.get(job.type);
    if (!handler) {
      await fail({ ...job, attempts: job.max_attempts }, new Error(`No handler registered for ${job.type}`));
      failed += 1;
      continue;
    }
    try {
      const outcome = await handler({ id: job.id, tenantId: job.tenant_id, payload: job.payload, attempts: job.attempts });
      await finish(job.id, outcome);
      processed += 1;
    } catch (err) {
      await fail(job, err);
      failed += 1;
    }
  }
  return { processed, failed };
}

/** Queue health for one tenant (never exposes other tenants' jobs). */
export async function queueStats(tenantId: string) {
  const rows = await db().execute<{ status: string; type: string; n: number }>(
    sql`select status, type, count(*)::int as n from jobs where tenant_id = ${tenantId} and created_at > now() - interval '7 days' group by status, type order by type, status`,
  );
  const dead = await db().execute<{ id: string; type: string; last_error: string | null; finished_at: Date | null }>(
    sql`select id, type, last_error, finished_at from jobs where tenant_id = ${tenantId} and status = 'dead' order by finished_at desc nulls last limit 20`,
  );
  return { counts: [...rows], dead: [...dead] };
}
