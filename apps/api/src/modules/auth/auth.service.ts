import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Role, User } from "@prisma/client";
import { config } from "../../config.js";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { HttpError, unauthorized } from "../../lib/errors.js";
import { hashToken, newRefreshToken, signAccessToken } from "../../lib/tokens.js";

type ClientInfo = { ip?: string | null; userAgent?: string | null };

export type Session = {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: { id: string; email: string; role: Role; firstName: string; lastName: string };
};

const INVALID_LOGIN = "Invalid email or password";

// Compared against when the email doesn't exist, so a wrong email takes as long as a
// wrong password and response times don't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

export const hashPassword = (password: string) => bcrypt.hash(password, config.BCRYPT_ROUNDS);

export async function login(email: string, password: string, client: ClientInfo): Promise<Session> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !passwordOk || !user.isActive) {
    await audit({
      action: "auth.login_failed",
      actorId: user?.id,
      metadata: { email: email.trim().toLowerCase(), reason: !user ? "unknown_email" : !passwordOk ? "bad_password" : "inactive" },
      ip: client.ip,
    });
    throw unauthorized(INVALID_LOGIN);
  }

  const session = await issueSession(user, randomUUID(), client);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ action: "auth.login", actorId: user.id, ip: client.ip });
  return session;
}

// Swaps a refresh token for a new access token and a new refresh token (rotation).
export async function refresh(presented: string | undefined, client: ClientInfo): Promise<Session> {
  if (!presented) throw unauthorized("Session expired, please sign in again");

  const stored = await db.refreshToken.findUnique({ where: { tokenHash: hashToken(presented) }, include: { user: true } });
  if (!stored) throw unauthorized("Session expired, please sign in again");

  if (stored.revokedAt) {
    // Two browser tabs often refresh at the same moment with the same cookie. If this token
    // was swapped a few seconds ago and its session is still alive, that's what happened:
    // tell the client to retry (its cookie jar now holds the new token) instead of
    // treating it as theft.
    if (await isRecentRotation(stored)) throw refreshRace();

    // Otherwise this token was already used and the session moved on. Either an attacker or
    // the real user is replaying it, and we can't tell which, so end the whole session.
    await handleReuse(stored, client);
    throw unauthorized("Session expired, please sign in again");
  }
  if (stored.expiresAt < new Date() || !stored.user.isActive) {
    throw unauthorized("Session expired, please sign in again");
  }

  // Claim the token: only one of two simultaneous refreshes can succeed.
  const claimed = await db.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (claimed.count === 0) {
    // Another request claimed this token a moment ago: the same race as above.
    throw refreshRace();
  }

  const session = await issueSession(stored.user, stored.familyId, client);
  const next = await db.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(session.refreshToken) } });
  await db.refreshToken.update({ where: { id: stored.id }, data: { replacedById: next.id } });
  return session;
}

export async function logout(presented: string | undefined, client: ClientInfo) {
  if (!presented) return;
  const stored = await db.refreshToken.findUnique({ where: { tokenHash: hashToken(presented) } });
  if (!stored) return;
  await revokeFamily(stored.familyId);
  await audit({ action: "auth.logout", actorId: stored.userId, ip: client.ip });
}

export async function revokeAllForUser(userId: string) {
  await db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

const refreshRace = () => new HttpError(409, "Session was refreshed by another tab; retry", "refresh_race");

async function isRecentRotation(stored: { familyId: string; revokedAt: Date | null }) {
  if (!stored.revokedAt) return false;
  const age = Date.now() - stored.revokedAt.getTime();
  if (age > config.REFRESH_REUSE_GRACE_SECONDS * 1000) return false;
  // After a logout or a theft alert the whole family is revoked, so there's no live token.
  const live = await db.refreshToken.count({ where: { familyId: stored.familyId, revokedAt: null } });
  return live > 0;
}

// Returns how many live tokens were revoked.
async function revokeFamily(familyId: string): Promise<number> {
  const { count } = await db.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  return count;
}

// Only log a theft when the reuse actually ended a live session. Presenting a token from
// a session that was already shut down (after logout, or after an earlier theft alert)
// is simply rejected, so the audit log isn't flooded with repeat alerts.
async function handleReuse(stored: { userId: string; familyId: string }, client: ClientInfo) {
  const revoked = await revokeFamily(stored.familyId);
  if (revoked > 0) {
    await audit({ action: "auth.refresh_reuse_detected", actorId: stored.userId, metadata: { familyId: stored.familyId }, ip: client.ip });
  }
}

async function issueSession(
  user: Pick<User, "id" | "email" | "role" | "firstName" | "lastName">,
  familyId: string,
  client: ClientInfo,
): Promise<Session> {
  const refreshToken = newRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      familyId,
      expiresAt: refreshExpiresAt,
      ip: client.ip ?? null,
      userAgent: client.userAgent?.slice(0, 255) ?? null,
    },
  });
  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role }),
    refreshToken,
    refreshExpiresAt,
    user: { id: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName },
  };
}
