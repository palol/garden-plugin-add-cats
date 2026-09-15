import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
    testTimeout: 30000,
    pool: "forks",
    poolOptions: { forks: { singleFork: false } },
  },
});
