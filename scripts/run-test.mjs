// Test runner: bundle a .ts test with esbuild (resolves the worker's extensionless
// imports + strips types), then execute it. Node's native loader can't resolve the
// worker's bundler-style imports, so we bundle first.

import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entry = process.argv[2];
if (!entry) {
  console.error("usage: node scripts/run-test.mjs <test.ts>");
  process.exit(1);
}

const result = await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "warning",
});

const dir = mkdtempSync(join(tmpdir(), "tradeauto-test-"));
const outFile = join(dir, "bundled-test.mjs");
writeFileSync(outFile, result.outputFiles[0].text);

await import(pathToFileURL(outFile).href);
