import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: "./apps/api/src/db/schema.ts",
  out: "./apps/api/drizzle",
});
