import { execSync } from "node:child_process";

let lastTag = "";
try {
  lastTag = execSync("git describe --tags --abbrev=0", { encoding: "utf8" }).trim();
} catch {
  // no tags yet
}

let [major, minor, patch] = [0, 1, 0];
if (lastTag) {
  const match = lastTag.match(/(\d+)\.(\d+)\.(\d+)/);
  if (match) [major, minor, patch] = match.slice(1).map(Number);
  patch += 1;
}

console.log(`${major}.${minor}.${patch}`);