import { createApp } from "./app.js";
import { config } from "./config.js";
import { db } from "./db.js";

const server = createApp().listen(config.PORT, () => {
  console.log(`Smart Campus API listening on http://localhost:${config.PORT}`);
});

// Finish in-flight requests and close the database pool on shutdown.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(async () => {
      await db.$disconnect();
      process.exit(0);
    });
  });
}
