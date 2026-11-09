import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "error",
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg, "bad_request");
export const unauthorized = (msg = "Authentication required") => new HttpError(401, msg, "unauthorized");
export const forbidden = (msg = "You do not have permission to do that") => new HttpError(403, msg, "forbidden");
export const notFound = (msg = "Not found") => new HttpError(404, msg, "not_found");
export const conflict = (msg: string) => new HttpError(409, msg, "conflict");

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound(`No route for ${req.method} ${req.path}`));
};

// One place that turns every error into the same JSON shape:
// { error: { code, message, details? } }
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "validation_error",
        message: "Some fields are missing or invalid",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const fields = (err.meta?.target as string[] | undefined)?.join(", ") ?? "field";
    res.status(409).json({ error: { code: "conflict", message: `A record with that ${fields} already exists` } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "internal_error", message: "Something went wrong" } });
};
