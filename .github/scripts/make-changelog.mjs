import { execSync } from "node:child_process";

const newVersion = process.argv[2] ?? "";
const prevTag = process.argv[3] ?? "";
const repo = process.env.GITHUB_REPOSITORY ?? "";

const range = prevTag ? `${prevTag}..HEAD` : "";
const log = execSync(`git log ${range} --pretty=format:%h%x09%s`, {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
}).trim();

const lines = log ? log.split("\n") : [];

function groupOf(subject) {
  const s = subject.toLowerCase();
  if (/^(feat|feature|add|new|اضافه|افزودن|جدید)/.test(s)) return "Added";
  if (/^(fix|bug|hotfix|رفع|اصلاح)/.test(s)) return "Fixed";
  if (/^(refactor|بازنویسی|بازسازی)/.test(s)) return "Refactored";
  if (/^(docs|مستند)/.test(s)) return "Documentation";
  if (/^(chore|build|ci|deps|perf|test)/.test(s)) return "Chores";
  return "Other";
}

const groups = new Map();
for (const line of lines) {
  const tab = line.indexOf("\t");
  const sha = line.slice(0, tab);
  const subject = line.slice(tab + 1);
  const group = groupOf(subject);
  if (!groups.has(group)) groups.set(group, []);
  const link = repo ? `[\`${sha}\`](https://github.com/${repo}/commit/${sha})` : `\`${sha}\``;
  groups.get(group).push(`- ${link} ${subject}`);
}

const header = newVersion ? `## ReadLynx v${newVersion}` : "## What's Changed";
const parts = [header, ""];

if (groups.size === 0) {
  parts.push("No changes since the last release.");
} else {
  for (const [name, items] of groups) {
    parts.push(`### ${name}`, ...items, "");
  }
}

parts.push("Install the installer for your platform from the assets below.");

if (prevTag && repo) {
  parts.push("", `**Full Changelog**: https://github.com/${repo}/compare/${prevTag}...v${newVersion}`);
}

console.log(parts.join("\n"));