import type { Config } from "drizzle-kit";
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  // Same env-backed path the runtime client opens (src/db/index.ts). Hardcoding
  // data.sqlite meant db:push created tables in a different file than the app
  // reads whenever SQLITE_PATH is set, and every query then hit "no such table".
  dbCredentials: { url: process.env.SQLITE_PATH ?? "data.sqlite" },
} satisfies Config;
