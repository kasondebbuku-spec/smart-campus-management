import type { Prisma } from "@prisma/client";
import { db } from "../db.js";

export type AuditEntry = {
  action: string;
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
};

type Client = Pick<typeof db, "auditLog">;

// Writes one audit entry. Pass a transaction client to record it atomically with the change.
export async function audit(entry: AuditEntry, client: Client = db) {
  await client.auditLog.create({
    data: {
      action: entry.action,
      actorId: entry.actorId ?? null,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata,
      ip: entry.ip ?? null,
    },
  });
}
