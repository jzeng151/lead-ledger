import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

// Route the whole suite at a throwaway, per-process SQLite file instead of the
// demo data.sqlite. This runs before the test files are imported, so when
// src/db/index.ts first opens its connection it reads this path (`process.env
// .SQLITE_PATH ?? "data.sqlite"`). The demo DB is never touched by the tests.
const dbPath = path.join(os.tmpdir(), `lead-ledger-test-${process.pid}.sqlite`);
for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(dbPath + suffix, { force: true });
process.env.SQLITE_PATH = dbPath;

// Create the schema the tests exercise. Mirrors src/db/schema.ts (kept in sync by
// hand; CREATE ... IF NOT EXISTS is idempotent). Tests don't run `db:push`.
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id text PRIMARY KEY NOT NULL,
    name text NOT NULL,
    email text,
    title text,
    company_name text,
    company_domain text,
    props text,
    synced_at integer NOT NULL
  );
  CREATE TABLE IF NOT EXISTS runs (
    id text PRIMARY KEY NOT NULL,
    contact_id text NOT NULL,
    status text NOT NULL,
    plan text,
    started_at integer,
    finished_at integer
  );
  CREATE TABLE IF NOT EXISTS run_events (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    run_id text NOT NULL,
    agent text NOT NULL,
    type text NOT NULL,
    payload text,
    ts integer NOT NULL
  );
  CREATE TABLE IF NOT EXISTS dossiers (
    run_id text PRIMARY KEY NOT NULL,
    per_agent text,
    verification text,
    merged text
  );
  CREATE TABLE IF NOT EXISTS scores (
    run_id text PRIMARY KEY NOT NULL,
    contact_id text NOT NULL,
    fit integer NOT NULL,
    engagement integer NOT NULL,
    timing integer,
    priority integer NOT NULL,
    grade text NOT NULL,
    needs_review integer NOT NULL,
    review_reasons text,
    rationale text,
    next_step text,
    citations text
  );
  CREATE TABLE IF NOT EXISTS writebacks (
    contact_id text PRIMARY KEY NOT NULL,
    status text NOT NULL,
    payload text,
    approved_at integer,
    written_at integer
  );
  CREATE TABLE IF NOT EXISTS icp_config (
    id text PRIMARY KEY NOT NULL,
    config text NOT NULL
  );
`);

// The app no longer ships seed contacts (real contacts come from HubSpot), so the
// suite seeds the one contact the adapter smoke test reads. c-northwind pairs with
// the northwind.dev enrichment fixture that backs the hubspot mock-tool assertions.
// A populated DB also stops the smoke test from shelling out to `db:push && seed`,
// which (via drizzle.config) would target the demo data.sqlite. synced_at is Unix
// seconds to match drizzle's timestamp mode; the exact value is irrelevant.
const TEST_CONTACTS = [
  { id: "c-northwind", name: "Priya Nair", email: "priya@northwind.dev", title: "VP Engineering", companyName: "Northwind Labs", companyDomain: "northwind.dev" },
];
const now = Math.floor(Date.now() / 1000);
const insert = db.prepare(
  "INSERT OR IGNORE INTO contacts (id, name, email, title, company_name, company_domain, props, synced_at) VALUES (?, ?, ?, ?, ?, ?, '{}', ?)",
);
for (const c of TEST_CONTACTS) {
  insert.run(c.id, c.name, c.email, c.title, c.companyName, c.companyDomain, now);
}

db.close();
