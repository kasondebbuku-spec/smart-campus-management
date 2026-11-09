import "dotenv/config";
import { z } from "zod";

// All settings are read and checked once, at startup, so a missing secret fails fast
// instead of surfacing as a confusing error on the first request.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(10),
});

export type Config = z.infer<typeof schema>;

export const config: Config = schema.parse(process.env);
