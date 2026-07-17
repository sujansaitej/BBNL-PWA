import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // jsdom would pull another dep; happy-dom too. We only need localStorage,
    // File and FormData — `fetch` is always mocked. Node 22 has File/FormData
    // natively, so the only gap is localStorage, shimmed in setup.
    environment: "node",
    setupFiles: ["./src/test-setup.js"],
    include: ["src/**/*.test.js"],
  },
});
