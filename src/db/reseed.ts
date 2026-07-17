import { notInArray } from "drizzle-orm";
import { db, schema } from "./index";
import { SEED_CONTACTS } from "../fixtures/contacts";
import { DEFAULT_ICP } from "../lib/icp";

const { contacts, runs, runEvents, dossiers, scores, writebacks, icpConfig } = schema;

// Clear every runtime table so the queue starts from a clean, unscored state.
db.delete(runEvents).run();
db.delete(dossiers).run();
db.delete(scores).run();
db.delete(writebacks).run();
db.delete(runs).run();

// Drop any contact outside the canonical seed set (removes test rows like c-test-orch).
db.delete(contacts)
  .where(notInArray(contacts.id, SEED_CONTACTS.map((c) => c.id)))
  .run();

// Upsert the 12 seed contacts, refreshing syncedAt on each run.
const now = new Date();
for (const c of SEED_CONTACTS) {
  const row = { ...c, props: {}, syncedAt: now };
  db.insert(contacts).values(row).onConflictDoUpdate({ target: contacts.id, set: row }).run();
}

// Ensure the default ICP config exists; leave any edited config in place.
db.insert(icpConfig).values({ id: "default", config: DEFAULT_ICP }).onConflictDoNothing().run();

console.log(`Reseeded: ${SEED_CONTACTS.length} contacts, scores/runs/writebacks cleared.`);
