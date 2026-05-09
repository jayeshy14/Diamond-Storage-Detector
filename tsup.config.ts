import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  splitting: false,
  shims: false,
  banner: ({ format }) => (format === "esm" ? { js: "#!/usr/bin/env node" } : {}),
});
