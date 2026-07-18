import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const contacts = sqliteTable("contacts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  title: text("title"),
  companyName: text("company_name"),
  companyDomain: text("company_domain"),
  props: text("props", { mode: "json" }).$type<Record<string, unknown>>(),
  syncedAt: integer("synced_at", { mode: "timestamp" }).notNull(),
});

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  contactId: text("contact_id").notNull(),
  status: text("status").notNull(),
  plan: text("plan", { mode: "json" }),
  startedAt: integer("started_at", { mode: "timestamp" }),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
});

export const runEvents = sqliteTable("run_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull(),
  agent: text("agent").notNull(),
  type: text("type").notNull(),
  payload: text("payload", { mode: "json" }),
  ts: integer("ts", { mode: "timestamp" }).notNull(),
});

export const dossiers = sqliteTable("dossiers", {
  runId: text("run_id").primaryKey(),
  perAgent: text("per_agent", { mode: "json" }),
  verification: text("verification", { mode: "json" }),
  merged: text("merged", { mode: "json" }),
});

export const scores = sqliteTable("scores", {
  runId: text("run_id").primaryKey(),
  contactId: text("contact_id").notNull(),
  fit: integer("fit").notNull(),
  engagement: integer("engagement").notNull(), // first-party intent, 0-100
  timing: integer("timing"), // signed news-trigger signal, -100..100
  priority: integer("priority").notNull(),
  grade: text("grade").notNull(),
  needsReview: integer("needs_review", { mode: "boolean" }).notNull(),
  reviewReasons: text("review_reasons", { mode: "json" }).$type<string[]>(),
  rationale: text("rationale"),
  nextStep: text("next_step"),
  citations: text("citations", { mode: "json" }),
});

export const writebacks = sqliteTable("writebacks", {
  contactId: text("contact_id").primaryKey(),
  status: text("status").notNull(),
  payload: text("payload", { mode: "json" }),
  approvedAt: integer("approved_at", { mode: "timestamp" }),
  writtenAt: integer("written_at", { mode: "timestamp" }),
});

export const icpConfig = sqliteTable("icp_config", {
  id: text("id").primaryKey(),
  config: text("config", { mode: "json" }).notNull(),
});
