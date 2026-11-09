import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../../config.js";
import { db } from "../../db.js";
import { authenticate, currentUser } from "../../middleware/auth.js";
import * as auth from "./auth.service.js";

// The refresh token lives in an httpOnly cookie that page scripts can't read, and is
// only sent to the auth routes.
const REFRESH_COOKIE = "refresh_token";
const COOKIE_PATH = "/api/v1/auth";

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const clientInfo = (req: Request) => ({ ip: req.ip, userAgent: req.get("user-agent") });

function sendSession(res: Response, session: auth.Session) {
  res.cookie(REFRESH_COOKIE, session.refreshToken, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "strict",
    path: COOKIE_PATH,
    expires: session.refreshExpiresAt,
  });
  res.json({ accessToken: session.accessToken, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS, user: session.user });
}

export function authRouter(opts: { loginRateLimit: number }) {
  const router = Router();

  // Slows down password guessing: a limited number of attempts per IP every 15 minutes.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: opts.loginRateLimit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: { code: "too_many_requests", message: "Too many sign-in attempts. Try again in 15 minutes." } },
  });

  router.post("/login", loginLimiter, async (req, res) => {
    const { email, password } = loginBody.parse(req.body);
    sendSession(res, await auth.login(email, password, clientInfo(req)));
  });

  router.post("/refresh", async (req, res) => {
    sendSession(res, await auth.refresh(req.cookies?.[REFRESH_COOKIE], clientInfo(req)));
  });

  router.post("/logout", async (req, res) => {
    await auth.logout(req.cookies?.[REFRESH_COOKIE], clientInfo(req));
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
    res.status(204).end();
  });

  router.get("/me", authenticate, async (req, res) => {
    const me = await db.user.findUniqueOrThrow({
      where: { id: currentUser(req).id },
      select: {
        id: true,
        email: true,
        role: true,
        firstName: true,
        lastName: true,
        student: { select: { id: true, studentNumber: true, programme: true, yearOfStudy: true } },
        lecturer: { select: { id: true, staffNumber: true, department: true } },
      },
    });
    res.json(me);
  });

  return router;
}
