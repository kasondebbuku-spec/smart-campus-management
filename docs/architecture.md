# Architecture

## Overview

```mermaid
flowchart LR
    subgraph Clients
      S([Student phone])
      L([Lecturer laptop])
      A([Admin])
    end
    subgraph Web["apps/web — Next.js"]
      UI[Role-based dashboards]
    end
    subgraph API["apps/api — Express + TypeScript"]
      MW[helmet · CORS · rate limit · auth middleware]
      AUTH[auth module]
      USERS[users module]
      COURSES[courses module]
      ATT[sessions + attendance modules]
      AUD[audit log]
    end
    DB[(PostgreSQL)]

    S & L & A --> UI
    UI -->|"/api/* forwarded, Bearer token"| MW
    MW --> AUTH & USERS & COURSES & ATT
    AUTH & USERS & COURSES & ATT --> AUD
    AUTH & USERS & COURSES & ATT -->|Prisma| DB
```

The repository is an npm-workspaces monorepo:

```
apps/api          REST API (Express 5, TypeScript, Prisma)
apps/web          Next.js front end (week 2)
packages/shared   types and constants used by both
docs/             requirements, architecture, database design
```

The API and web app are separate so the API can also serve a mobile app later, and so each can be deployed and scaled on its own.

## Request lifecycle

1. **helmet** sets security headers; **CORS** only allows the web app's origin to send cookies.
2. **authenticate** checks the Bearer token's signature and expiry, then loads the user to confirm the account is still active.
3. **requireRole** rejects roles that may not use the route (403).
4. The route handler **validates the body with Zod**. Invalid input never reaches the database.
5. Queries are **scoped to the user** (a lecturer's query only matches their own courses), so a missing check can't leak another course's data.
6. Data-changing actions write an **audit log** entry, inside the same transaction where it matters.
7. One **error handler** turns every error into `{ error: { code, message, details? } }`.

## Authentication design

```mermaid
sequenceDiagram
    participant C as Client
    participant API
    participant DB as PostgreSQL

    C->>API: POST /auth/login (email, password)
    API->>DB: find user, bcrypt.compare
    API->>DB: store hash(refresh token), new family
    API-->>C: access token (15 min) + refresh cookie (7 days, httpOnly)

    C->>API: GET /courses (Authorization: Bearer …)
    API-->>C: 200

    Note over C: 15 minutes later the access token expires
    C->>API: POST /auth/refresh (cookie)
    API->>DB: revoke old token, store new one in same family
    API-->>C: new access token + new refresh cookie

    Note over C,API: If a revoked refresh token is ever presented again
    C->>API: POST /auth/refresh (old cookie)
    API->>DB: revoke the whole family, write audit entry
    API-->>C: 401, sign in again
```

| Choice | Reason |
|---|---|
| **Short-lived access token** (JWT, 15 min) in memory | Stateless and fast to check; a stolen one stops working quickly |
| **Refresh token** in an `httpOnly`, `SameSite=Strict` cookie scoped to `/api/v1/auth` | Page scripts can't read it, so an XSS bug can't steal it; it's only sent to the auth routes |
| Refresh tokens **stored as SHA-256 hashes** | A leaked database backup can't be used to sign in |
| **Rotation with reuse detection** | Each refresh token works once. Reuse means it was copied, so the whole session family is revoked |
| Access check **loads the user on every request** | Deactivating an account takes effect immediately, not after 15 minutes |
| **Same error** for unknown email and wrong password, and a dummy bcrypt compare | Attackers can't find out which emails are registered |
| **Rate limit** on login | Slows down password guessing |
| **Grace period** of 10 seconds for a just-swapped refresh token | Two tabs refreshing together isn't theft: the second gets `409 refresh_race` and retries with the new cookie, instead of the whole session being revoked |
| Web app **forwards `/api/*`** to the API | The refresh cookie is first-party to the site, so no cross-origin cookie settings are needed |
| Access token kept **in memory only** in the browser | Not in `localStorage`, where any script on the page could read it; a reload gets a fresh one from the refresh cookie |

## QR check-in

```mermaid
sequenceDiagram
    participant L as Lecturer screen
    participant API
    participant S as Student phone
    participant DB as PostgreSQL

    L->>API: POST /sessions/:id/check-in/open
    loop every few seconds
      L->>API: GET /sessions/:id/check-in/qr
      API-->>L: token = id.window.HMAC(id, window), refreshInSeconds
    end
    S->>API: POST /check-in { token }
    API->>API: recompute HMAC, check window is current or previous
    API->>DB: session open? student enrolled?
    API->>DB: insert AttendanceRecord (unique per student per session)
    API-->>S: 201 PRESENT or LATE
```

| Choice | Reason |
|---|---|
| Token changes every **30 seconds** | A photo of the screen forwarded to someone outside the room stops working within a minute |
| **One previous window accepted** | A student who scans one second before the code changes isn't rejected |
| Tokens are **signed, not stored** | No table of codes to clean up; the server recomputes the HMAC to check one. The key is derived separately from the access-token key |
| **Late is measured from the session start**, not from when check-in opened | Matches how lecturers think: "class is at 08:00, late after 08:10" |
| **Unique (session, student)** in the database | Two scans at the same moment can't create two records; the second gets "already checked in" |
| A scan **never overwrites a hand-marked record** | If a lecturer marked someone EXCUSED, a later scan doesn't change it |
| Forged codes and non-enrolled scans are **audited** | Repeated attempts show up in the audit log |

**Known limitation:** a student in the room can still read the code aloud or message it within the 60-second window. Possible next steps are checking the phone's location against the venue, or limiting each student account to one registered device.

## Technology choices

| Technology | Why |
|---|---|
| TypeScript | Catches whole classes of bugs at compile time; shared types between API and web |
| Express 5 | Small, well understood, and handles errors thrown in async handlers natively |
| PostgreSQL | Relational data with real constraints (unique enrolments, foreign keys) and transactions |
| Prisma | Type-safe queries and versioned migrations |
| Zod | One schema both validates input and gives the TypeScript type |
| Vitest + Supertest | Fast unit tests and HTTP-level integration tests against a real database |
| Docker Compose | Anyone can start the database with one command |
| GitHub Actions | Every pull request is type-checked, linted, tested and built |
