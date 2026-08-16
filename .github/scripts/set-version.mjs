import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node set-version.mjs <version>");
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
packageJson.version = version;
writeFileSync(
  new URL("../../package.json", import.meta.url),
  JSON.stringify(packageJson, null, 2) + "\n",
);
console.log(`package.json version set to ${version}`);