import { defineConfig, mergeConfig } from "vitest/config";
import { baseVitestConfig } from "./vitest.base.config.js";

export default mergeConfig(
  baseVitestConfig,
  defineConfig({
    test: {
      include: ["tests/unit/commands/**/*.test.ts"],
      setupFiles: ["./tests/setup/command-coverage.ts"],
    },
  }),
);
