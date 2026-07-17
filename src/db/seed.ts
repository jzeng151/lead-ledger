import { db, schema } from "./index";
import { SEED_CONTACTS } from "../fixtures/contacts";
import { DEFAULT_ICP } from "../lib/icp";

const now = new Date();
db.insert(schema.contacts).values(SEED_CONTACTS.map(c => ({ ...c, props: {}, syncedAt: now }))).run();
db.insert(schema.icpConfig).values({ id: "default", config: DEFAULT_ICP }).onConflictDoNothing().run();
console.log(`Seeded ${SEED_CONTACTS.length} contacts.`);
