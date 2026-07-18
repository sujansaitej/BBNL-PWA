import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  // Needed so component tests can render JSX. Service-layer tests don't use
  // it, but the transform is harmless for them.
  plugins: [react()],
  resolve: {
    // Mirror the app's "@" alias so components can be imported the same way
    // they are in src.
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    // DEFAULT stays `node` — the service-layer suite only needs localStorage,
    // File and FormData, and node is much faster to spin up.
    //
    // Component tests opt in per file with a docblock:
    //     /** @vitest-environment jsdom */
    // That combination exists because this repo had NO component tests at
    // all, which is precisely how a broken dropdown shipped twice: the build
    // is green whether or not the thing actually renders.
    environment: "node",
    setupFiles: ["./src/test-setup.js"],
    include: ["src/**/*.test.js", "src/**/*.test.jsx"],
  },
});
