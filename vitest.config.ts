import { defineConfig } from "vitest/config";

export default defineConfig({
  // Component tests import `.tsx` modules. Without the automatic JSX runtime,
  // esbuild emits classic `React.createElement` and rendering throws
  // "React is not defined" (no component imports the React namespace).
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
});
