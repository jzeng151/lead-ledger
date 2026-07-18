import { db, schema } from "./index";
import { DEFAULT_ICP } from "../lib/icp";

// Contacts are synced from HubSpot (dashboard "Sync"), not seeded locally. This
// only ensures the default ICP config exists.
db.insert(schema.icpConfig).values({ id: "default", config: DEFAULT_ICP }).onConflictDoNothing().run();
console.log("Seeded default ICP config. Contacts are synced from HubSpot.");
