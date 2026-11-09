import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { config } from "../config.js";

const ISSUER = "smart-campus-api";

export type AccessTokenPayload = { sub: string; role: Role };

// Access tokens are short-lived JWTs sent in the Authorization header.
export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign({ role: payload.role }, config.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    subject: payload.sub,
    issuer: ISSUER,
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
  });
}

// Returns null for any invalid, expired or tampered token.
export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET, { algorithms: ["HS256"], issuer: ISSUER });
    if (typeof decoded === "string" || !decoded.sub) return null;
    return { sub: decoded.sub, role: decoded.role as Role };
  } catch {
    return null;
  }
}

// Refresh tokens are opaque random strings. The database stores only their hash,
// so a leaked database backup cannot be used to sign in.
export const newRefreshToken = () => randomBytes(48).toString("base64url");

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
