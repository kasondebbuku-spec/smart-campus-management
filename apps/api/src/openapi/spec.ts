// OpenAPI 3.1 description of the Smart Campus API, served at /api/docs.
// tests/openapi.test.ts fails if a route exists in the code but not here (or the other way round).

type Schema = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: Schema) => ({ content: { "application/json": { schema } } });
const ok = (description: string, schema: Schema) => ({ description, ...json(schema) });
const err = (description: string) => ({ description, ...json(ref("Error")) });
const list = (item: string) => ({ type: "object", properties: { items: { type: "array", items: ref(item) } }, required: ["items"] });
const idPath = (name = "id", description = "Record id") => ({ name, in: "path", required: true, description, schema: { type: "string" } });
const body = (schema: Schema, description?: string) => ({ required: true, description, ...json(schema) });

const DATETIME = { type: "string", format: "date-time" };
const STATUS = { type: "string", enum: ["PRESENT", "LATE", "ABSENT", "EXCUSED"] };

// Errors most routes can return.
const common = {
  400: err("Validation failed; `details` lists each invalid field"),
  401: err("Missing, invalid or expired access token"),
};
const managerErrors = {
  ...common,
  403: err("You can see this course but only its lecturer or an admin can change it"),
  404: err("Not found, or you can't see it"),
};

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Smart Campus API",
    version: "0.2.0",
    description: [
      "University management API: accounts, courses, class sessions and attendance.",
      "",
      "**Authentication.** Call `POST /api/v1/auth/login` to get an access token, then click **Authorize** and paste it.",
      "Access tokens last 15 minutes. The refresh token is set as an `httpOnly` cookie and exchanged at `POST /api/v1/auth/refresh`.",
      "",
      "**Visibility.** Admins see everything, lecturers see the courses they teach, students see the courses they're enrolled in.",
      "A record you aren't allowed to see returns 404, so its existence isn't revealed.",
      "",
      "**Errors** always look like `{ \"error\": { \"code\", \"message\", \"details\"? } }`.",
    ].join("\n"),
    license: { name: "MIT" },
  },
  servers: [{ url: "/", description: "This server" }],
  tags: [
    { name: "Auth", description: "Sign in, refresh and sign out" },
    { name: "Users", description: "Account management (admins only)" },
    { name: "Courses", description: "Courses, enrolment and class lists" },
    { name: "Sessions", description: "Class sessions and timetable clash detection" },
    { name: "Attendance", description: "QR check-in, manual marking and rosters" },
    { name: "System" },
  ],
  security: [{ bearerAuth: [] }],

  paths: {
    "/health": {
      get: {
        tags: ["System"],
        summary: "Liveness and database check",
        security: [],
        responses: { 200: ok("Healthy", { type: "object", properties: { status: { const: "ok" } } }) },
      },
    },

    // ---------- Auth ----------
    "/api/v1/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Sign in",
        description: "Rate-limited per IP. An unknown email and a wrong password give the same answer.",
        security: [],
        requestBody: body({
          type: "object",
          required: ["email", "password"],
          properties: { email: { type: "string", format: "email" }, password: { type: "string" } },
        }),
        responses: {
          200: { ...ok("Signed in; also sets the `refresh_token` cookie", ref("Session")), headers: { "Set-Cookie": { schema: { type: "string" } } } },
          400: common[400],
          401: err("Invalid email or password"),
          429: err("Too many sign-in attempts"),
        },
      },
    },
    "/api/v1/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Exchange the refresh cookie for a new access token",
        description:
          "Rotates the refresh token: the old one stops working. Presenting an already-used refresh token revokes the whole session, because it was probably copied.",
        security: [{ refreshCookie: [] }],
        responses: { 200: ok("New access token; also sets a new cookie", ref("Session")), 401: err("Session expired or revoked") },
      },
    },
    "/api/v1/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Sign out and revoke the session",
        security: [{ refreshCookie: [] }],
        responses: { 204: { description: "Signed out" } },
      },
    },
    "/api/v1/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "The signed-in user and their profile",
        responses: { 200: ok("Current user", ref("User")), 401: common[401] },
      },
    },

    // ---------- Users ----------
    "/api/v1/users": {
      post: {
        tags: ["Users"],
        summary: "Create an account",
        description: "The body depends on `role`: students need a student number, lecturers a staff number.",
        requestBody: body({ oneOf: [ref("NewAdmin"), ref("NewStudent"), ref("NewLecturer")], discriminator: { propertyName: "role" } }),
        responses: { 201: ok("Created", ref("User")), ...common, 403: err("Admins only"), 409: err("Email, student number or staff number already used") },
      },
      get: {
        tags: ["Users"],
        summary: "Search and list accounts",
        parameters: [
          { name: "role", in: "query", schema: { type: "string", enum: ["ADMIN", "LECTURER", "STUDENT"] } },
          { name: "search", in: "query", description: "Matches name, email or student number", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: {
          200: ok("A page of users", {
            type: "object",
            properties: { items: { type: "array", items: ref("User") }, page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" } },
          }),
          ...common,
          403: err("Admins only"),
        },
      },
    },
    "/api/v1/users/{id}": {
      get: {
        tags: ["Users"],
        summary: "One account",
        parameters: [idPath()],
        responses: { 200: ok("User", ref("User")), ...common, 403: err("Admins only"), 404: err("User not found") },
      },
    },
    "/api/v1/users/{id}/deactivate": {
      post: {
        tags: ["Users"],
        summary: "Deactivate an account",
        description: "Signs the user out everywhere at once: refresh tokens are revoked and access tokens are rejected on the next request.",
        parameters: [idPath()],
        responses: { 204: { description: "Deactivated" }, ...common, 403: err("Admins only"), 404: err("User not found") },
      },
    },

    // ---------- Courses ----------
    "/api/v1/courses": {
      get: {
        tags: ["Courses"],
        summary: "Courses visible to you",
        responses: { 200: ok("Courses", list("Course")), 401: common[401] },
      },
      post: {
        tags: ["Courses"],
        summary: "Create a course",
        requestBody: body({
          type: "object",
          required: ["code", "title", "semester"],
          properties: {
            code: { type: "string", pattern: "^[A-Za-z]{3}\\d{4}$", examples: ["CSC3011"] },
            title: { type: "string", minLength: 3, maxLength: 160 },
            semester: { type: "string", pattern: "^\\d{4}-S[12]$", examples: ["2026-S2"] },
            lecturerId: { type: "string", description: "Lecturer profile id" },
          },
        }),
        responses: { 201: ok("Created", ref("Course")), ...common, 403: err("Admins only"), 409: err("Course code already used") },
      },
    },
    "/api/v1/courses/{id}": {
      get: {
        tags: ["Courses"],
        summary: "One course",
        parameters: [idPath()],
        responses: { 200: ok("Course", ref("Course")), 401: common[401], 404: err("Not found, or you can't see it") },
      },
    },
    "/api/v1/courses/{id}/enrolments": {
      post: {
        tags: ["Courses"],
        summary: "Enrol students",
        description: "Students who are already enrolled are skipped, so this is safe to repeat.",
        parameters: [idPath()],
        requestBody: body({
          type: "object",
          required: ["studentIds"],
          properties: { studentIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 500 } },
        }),
        responses: {
          201: ok("Enrolment result", { type: "object", properties: { added: { type: "integer" }, alreadyEnrolled: { type: "integer" } } }),
          ...common,
          403: err("Admins only"),
          404: err("Course not found"),
        },
      },
    },
    "/api/v1/courses/{id}/students": {
      get: {
        tags: ["Courses"],
        summary: "Class list",
        parameters: [idPath()],
        responses: {
          200: ok("Enrolled students", {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: { type: "object", properties: { enrolledAt: DATETIME, student: ref("StudentSummary") } },
              },
            },
          }),
          401: common[401],
          403: err("Students can't see class lists"),
          404: err("Not found, or not your course"),
        },
      },
    },

    // ---------- Sessions ----------
    "/api/v1/courses/{courseId}/sessions": {
      post: {
        tags: ["Sessions"],
        summary: "Schedule a class session",
        description:
          "Must end after it starts and last at most 6 hours. Refused if the course already has a session at that time, or the venue is booked by any course. Back-to-back bookings are fine.",
        parameters: [idPath("courseId", "Course id")],
        requestBody: body(ref("SessionTiming")),
        responses: { 201: ok("Created", ref("ClassSession")), ...managerErrors, 409: err("Course or venue clash") },
      },
      get: {
        tags: ["Sessions"],
        summary: "A course's timetable",
        parameters: [
          idPath("courseId", "Course id"),
          { name: "from", in: "query", description: "Sessions starting at or after", schema: DATETIME },
          { name: "to", in: "query", description: "Sessions starting before", schema: DATETIME },
        ],
        responses: { 200: ok("Sessions in time order", list("ClassSession")), ...common, 404: err("Not found, or you can't see it") },
      },
    },
    "/api/v1/sessions/{id}": {
      get: {
        tags: ["Sessions"],
        summary: "One session",
        parameters: [idPath()],
        responses: { 200: ok("Session", ref("ClassSession")), 401: common[401], 404: err("Not found, or you can't see it") },
      },
      patch: {
        tags: ["Sessions"],
        summary: "Move or re-room a session",
        description: "Same rules as creating. The audit log records the previous values.",
        parameters: [idPath()],
        requestBody: body({ ...ref("SessionTiming"), description: "Any of startsAt, endsAt, venue" }),
        responses: { 200: ok("Updated", ref("ClassSession")), ...managerErrors, 409: err("Course or venue clash") },
      },
      delete: {
        tags: ["Sessions"],
        summary: "Delete a session",
        parameters: [idPath()],
        responses: { 204: { description: "Deleted" }, ...managerErrors, 409: err("The session already has attendance") },
      },
    },

    // ---------- Attendance ----------
    "/api/v1/sessions/{id}/check-in/open": {
      post: {
        tags: ["Attendance"],
        summary: "Open QR check-in",
        description: "Opening again extends it. Students arriving more than `lateAfterMinutes` after the session start are marked LATE.",
        parameters: [idPath()],
        requestBody: {
          required: false,
          ...json({
            type: "object",
            properties: {
              durationMinutes: { type: "integer", minimum: 1, maximum: 180, default: 15 },
              lateAfterMinutes: { type: "integer", minimum: 0, maximum: 180, default: 10 },
            },
          }),
        },
        responses: {
          200: ok("Check-in window", {
            type: "object",
            properties: { id: { type: "string" }, checkInOpenedAt: DATETIME, checkInClosesAt: DATETIME, lateAfter: DATETIME },
          }),
          ...managerErrors,
          409: err("The session has ended"),
        },
      },
    },
    "/api/v1/sessions/{id}/check-in/close": {
      post: {
        tags: ["Attendance"],
        summary: "Close QR check-in",
        parameters: [idPath()],
        responses: { 204: { description: "Closed" }, ...managerErrors },
      },
    },
    "/api/v1/sessions/{id}/check-in/qr": {
      get: {
        tags: ["Attendance"],
        summary: "The QR code to show on screen",
        description:
          "The token changes every 30 seconds. Poll this and redraw the code when `refreshInSeconds` runs out. A code is accepted for its own 30 seconds and the next 30.",
        parameters: [idPath()],
        responses: {
          200: ok("Current code", {
            type: "object",
            properties: {
              token: { type: "string", examples: ["clx123.59383200.Xk3s9Qm1Lw0pTz8vR2aB_c"] },
              refreshInSeconds: { type: "integer", minimum: 1, maximum: 30 },
              closesAt: DATETIME,
              checkedIn: { type: "integer", description: "Students checked in by QR so far" },
            },
          }),
          ...managerErrors,
          409: err("Check-in is not open"),
        },
      },
    },
    "/api/v1/check-in": {
      post: {
        tags: ["Attendance"],
        summary: "Scan a QR code (students)",
        description: "Scanning again is harmless and never overwrites a record a lecturer marked by hand.",
        requestBody: body({ type: "object", required: ["token"], properties: { token: { type: "string" } } }),
        responses: {
          201: ok("Checked in", ref("CheckInResult")),
          200: ok("Already checked in", ref("CheckInResult")),
          400: err("Invalid or expired code"),
          401: common[401],
          403: err("Not a student, or not enrolled in this course"),
          409: err("Check-in is closed"),
        },
      },
    },
    "/api/v1/sessions/{id}/attendance": {
      get: {
        tags: ["Attendance"],
        summary: "Attendance roster",
        description: "Every enrolled student with their status for this session. `status: null` means not recorded yet.",
        parameters: [idPath()],
        responses: { 200: ok("Roster", ref("Roster")), ...managerErrors },
      },
      put: {
        tags: ["Attendance"],
        summary: "Mark or correct attendance by hand",
        description:
          "All-or-nothing: if any student isn't enrolled, nothing is saved. Each change is audited with the old and new status. Before the session starts, only EXCUSED is allowed.",
        parameters: [idPath()],
        requestBody: body({
          type: "object",
          required: ["records"],
          properties: {
            records: {
              type: "array",
              minItems: 1,
              maxItems: 500,
              items: { type: "object", required: ["studentId", "status"], properties: { studentId: { type: "string" }, status: STATUS } },
            },
          },
        }),
        responses: {
          200: ok("What changed", {
            type: "object",
            properties: { created: { type: "integer" }, updated: { type: "integer" }, unchanged: { type: "integer" } },
          }),
          ...managerErrors,
        },
      },
    },
    "/api/v1/sessions/{id}/attendance/mark-absent": {
      post: {
        tags: ["Attendance"],
        summary: "Mark everyone without a record ABSENT",
        description: "Only after the session has started and check-in is closed. Safe to run twice.",
        parameters: [idPath()],
        responses: {
          200: ok("How many were marked", { type: "object", properties: { markedAbsent: { type: "integer" } } }),
          ...managerErrors,
          409: err("Check-in is still open"),
        },
      },
    },
  },

  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Access token from /api/v1/auth/login" },
      refreshCookie: { type: "apiKey", in: "cookie", name: "refresh_token" },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string", examples: ["validation_error", "unauthorized", "forbidden", "not_found", "conflict"] },
              message: { type: "string" },
              details: { type: "array", items: { type: "object", properties: { path: { type: "string" }, message: { type: "string" } } } },
            },
          },
        },
      },
      Session: {
        type: "object",
        properties: {
          accessToken: { type: "string" },
          expiresIn: { type: "integer", description: "Seconds", examples: [900] },
          user: {
            type: "object",
            properties: {
              id: { type: "string" },
              email: { type: "string" },
              role: ref("Role"),
              firstName: { type: "string" },
              lastName: { type: "string" },
            },
          },
        },
      },
      Role: { type: "string", enum: ["ADMIN", "LECTURER", "STUDENT"] },
      User: {
        type: "object",
        properties: {
          id: { type: "string" },
          email: { type: "string", format: "email" },
          role: ref("Role"),
          firstName: { type: "string" },
          lastName: { type: "string" },
          isActive: { type: "boolean" },
          lastLoginAt: { type: ["string", "null"], format: "date-time" },
          student: {
            type: ["object", "null"],
            properties: { id: { type: "string" }, studentNumber: { type: "string" }, programme: { type: "string" }, yearOfStudy: { type: "integer" } },
          },
          lecturer: {
            type: ["object", "null"],
            properties: { id: { type: "string" }, staffNumber: { type: "string" }, department: { type: "string" } },
          },
        },
      },
      NewAccountBase: {
        type: "object",
        required: ["email", "password", "firstName", "lastName"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 10 },
          firstName: { type: "string" },
          lastName: { type: "string" },
        },
      },
      NewAdmin: { allOf: [ref("NewAccountBase"), { type: "object", required: ["role"], properties: { role: { const: "ADMIN" } } }] },
      NewStudent: {
        allOf: [
          ref("NewAccountBase"),
          {
            type: "object",
            required: ["role", "studentNumber", "programme", "yearOfStudy"],
            properties: {
              role: { const: "STUDENT" },
              studentNumber: { type: "string", pattern: "^\\d{8,10}$" },
              programme: { type: "string" },
              yearOfStudy: { type: "integer", minimum: 1, maximum: 7 },
            },
          },
        ],
      },
      NewLecturer: {
        allOf: [
          ref("NewAccountBase"),
          {
            type: "object",
            required: ["role", "staffNumber", "department"],
            properties: { role: { const: "LECTURER" }, staffNumber: { type: "string" }, department: { type: "string" } },
          },
        ],
      },
      Course: {
        type: "object",
        properties: {
          id: { type: "string" },
          code: { type: "string", examples: ["CSC3011"] },
          title: { type: "string" },
          semester: { type: "string", examples: ["2026-S2"] },
          lecturer: {
            type: ["object", "null"],
            properties: {
              id: { type: "string" },
              staffNumber: { type: "string" },
              user: { type: "object", properties: { firstName: { type: "string" }, lastName: { type: "string" } } },
            },
          },
          _count: { type: "object", properties: { enrolments: { type: "integer" } } },
        },
      },
      StudentSummary: {
        type: "object",
        properties: {
          id: { type: "string" },
          studentNumber: { type: "string" },
          programme: { type: "string" },
          yearOfStudy: { type: "integer" },
          user: { type: "object", properties: { firstName: { type: "string" }, lastName: { type: "string" }, email: { type: "string" } } },
        },
      },
      SessionTiming: {
        type: "object",
        required: ["startsAt", "endsAt", "venue"],
        properties: {
          startsAt: { ...DATETIME, examples: ["2026-11-16T08:00:00+02:00"] },
          endsAt: { ...DATETIME, examples: ["2026-11-16T10:00:00+02:00"] },
          venue: { type: "string", minLength: 2, maxLength: 120, examples: ["LT1"] },
        },
      },
      ClassSession: {
        type: "object",
        properties: {
          id: { type: "string" },
          courseId: { type: "string" },
          startsAt: DATETIME,
          endsAt: DATETIME,
          venue: { type: "string" },
          course: { type: "object", properties: { code: { type: "string" }, title: { type: "string" } } },
          _count: { type: "object", properties: { attendance: { type: "integer" } } },
        },
      },
      CheckInResult: {
        type: "object",
        properties: { alreadyCheckedIn: { type: "boolean" }, status: STATUS, course: { type: "string" }, recordedAt: DATETIME },
      },
      Roster: {
        type: "object",
        properties: {
          session: {
            type: "object",
            properties: { id: { type: "string" }, course: { type: "string" }, startsAt: DATETIME, checkInOpen: { type: "boolean" } },
          },
          summary: {
            type: "object",
            properties: Object.fromEntries(["enrolled", "present", "late", "absent", "excused", "notRecorded"].map((k) => [k, { type: "integer" }])),
          },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                studentNumber: { type: "string" },
                user: { type: "object", properties: { firstName: { type: "string" }, lastName: { type: "string" } } },
                status: { anyOf: [STATUS, { type: "null" }] },
                method: { type: ["string", "null"], enum: ["QR", "MANUAL", null] },
                recordedAt: { anyOf: [DATETIME, { type: "null" }] },
              },
            },
          },
        },
      },
    },
  },
};
