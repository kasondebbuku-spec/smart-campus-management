import type { RequestHandler } from "express";
import type { Role } from "@prisma/client";
import { db } from "../db.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/tokens.js";

export type AuthUser = { id: string; role: Role; email: string };

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

// Checks the Bearer token, then confirms the account still exists and is active,
// so a deactivated user is locked out immediately rather than when their token expires.
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return next(unauthorized());

  const user = await db.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, email: true, isActive: true },
  });
  if (!user || !user.isActive) return next(unauthorized());

  req.user = { id: user.id, role: user.role, email: user.email };
  next();
};

// Use after authenticate: requireRole("ADMIN"), requireRole("ADMIN", "LECTURER")
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };

export function currentUser(req: { user?: AuthUser }): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
