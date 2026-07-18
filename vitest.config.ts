import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Route handlers import through the "@/" alias Next resolves from tsconfig;
  // mirror it here so they can be unit-tested against the test DB.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { setupFiles: ["./vitest.setup.ts"] },
});
