// The staff audit log: every staff action records who did it, to which record, the record before and after, and
// the request it came from. It's written in the same transaction as the change, so the log never disagrees with
// the data. The request id comes from the request's async context, so services don't have to pass it around.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '@halden/contracts';
import type { Queryable } from './db.js';

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

export type AuditActor = { id: string | null; role: Role | null };

export async function audit(
  db: Queryable,
  actor: AuditActor,
  action: string,
  entity: { type: string; id: string },
  change: { before?: unknown; after?: unknown } = {},
  at: Date = new Date(),
) {
  await db.query(
    `INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, before, after, request_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      actor.id,
      actor.role,
      action,
      entity.type,
      entity.id,
      change.before === undefined ? null : JSON.stringify(change.before),
      change.after === undefined ? null : JSON.stringify(change.after),
      requestContext.getStore()?.requestId ?? null,
      at,
    ],
  );
}

/** Only the fields that changed, for a compact before/after. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(after)) {
    if (v !== undefined && JSON.stringify(before[k]) !== JSON.stringify(v)) {
      b[k] = before[k];
      a[k] = v;
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}
