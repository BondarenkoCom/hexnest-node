import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    dir: "test",
    include: [
      "**/*.test.ts"
    ],
    exclude: [
      "dist/**",
      "**/node_modules/**",
      "frontend/**",
      "src-tauri/**"
    ]
  }
});
