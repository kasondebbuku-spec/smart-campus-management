import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Tests only ever use TEST_DATABASE_URL, never the development database.
const { TEST_DATABASE_URL } = { ...loadEnv("test", process.cwd(), "TEST_"), ...process.env };

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false, // integration tests share one database
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL || "postgresql://unused:unused@localhost:5432/unused",
      ...(TEST_DATABASE_URL ? { TEST_DATABASE_URL } : {}),
      JWT_ACCESS_SECRET: "test-secret-that-is-definitely-longer-than-32-chars",
      BCRYPT_ROUNDS: "4", // fast hashing in tests
      LOGIN_RATE_LIMIT: "1000",
    },
  },
});
