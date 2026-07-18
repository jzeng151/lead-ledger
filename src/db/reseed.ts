import { db, schema } from "./index";
import { DEFAULT_ICP } from "../lib/icp";

const { contacts, runs, runEvents, dossiers, scores, writebacks, icpConfig } = schema;

// Reset local state to a clean slate. Contacts now come from HubSpot via the
// dashboard "Sync", so reseed clears the runtime tables and every synced contact;
// a fresh Sync repopulates the queue. The default ICP config is (re)ensured.
db.delete(runEvents).run();
db.delete(dossiers).run();
db.delete(scores).run();
db.delete(writebacks).run();
db.delete(runs).run();
db.delete(contacts).run();

// Refresh the default ICP to the current shape (a reset restores defaults, so a
// config schema change like the urgency/grades knobs propagates).
db.insert(icpConfig)
  .values({ id: "default", config: DEFAULT_ICP })
  .onConflictDoUpdate({ target: icpConfig.id, set: { config: DEFAULT_ICP } })
  .run();

console.log("Reset local state: contacts and runtime tables cleared, ICP config refreshed to defaults.");
