import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { db } from "./db.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";
import { attendanceRouter } from "./modules/attendance/attendance.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { coursesRouter } from "./modules/courses/courses.routes.js";
import { sessionsRouter } from "./modules/sessions/sessions.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { docsRouter } from "./openapi/docs.routes.js";

export type AppOptions = { loginRateLimit?: number };

export function createApp(opts: AppOptions = {}) {
  const app = express();

  app.set("trust proxy", 1); // read the client IP from the hosting provider's proxy
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGINS, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.get("/health", async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  });

  app.use("/api/docs", docsRouter); // interactive API docs
  app.use("/api/v1/auth", authRouter({ loginRateLimit: opts.loginRateLimit ?? config.LOGIN_RATE_LIMIT }));
  app.use("/api/v1/users", usersRouter);
  app.use("/api/v1/courses", coursesRouter);
  app.use("/api/v1", sessionsRouter); // /courses/:courseId/sessions and /sessions/:id
  app.use("/api/v1", attendanceRouter); // check-in and attendance rosters

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
