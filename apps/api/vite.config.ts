import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // Reuse workers across test files so each worker boots SQLite once (see @detour/db/testing).
    isolate: false,
    setupFiles: ["./src/test-setup.ts"],
  },
  run: {
    tasks: {
      // `wrangler types` writes worker-configuration.d.ts (git-ignored): the `Bindings` interface
      // from wrangler.jsonc and the workerd runtime types for its compatibility date and flags.
      "check:static": {
        command: "wrangler types --env-interface Bindings && vp check",
        cache: {
          input: [{ auto: true }, "!worker-configuration.d.ts"],
          output: [{ auto: true }, "!worker-configuration.d.ts"],
        },
      },
    },
  },
});
