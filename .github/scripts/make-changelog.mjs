import { execSync } from "node:child_process";
import { commitLink, installSection, compareLine } from "./notes-shared.mjs";

// Usage: node make-changelog.mjs <newVersion> <prevTag>
// Env:
//   GITHUB_REPOSITORY  - owner/repo (for commit links + compare link)
//   LLM_API_KEY        - repo SECRET. If set, commits are rewritten into
//                        user-friendly bullets via your own OpenAI-compatible
//                        endpoint. Without it, keyless heuristic below is used.
//   LLM_BASE_URL       - repo VARIABLE, e.g. https://api.openai.com/v1
//                        (default: https://api.openai.com/v1)
//   LLM_MODEL          - repo VARIABLE, e.g. gpt-4o-mini (default: gpt-4o-mini)
//   RELEASE_NOTES_LANG - repo VARIABLE, "en" (default) or "fa"
// The endpoint must accept POST {base}/chat/completions with a Bearer key
// (OpenAI-style: OpenAI, OpenRouter, DeepSeek, Groq, Together, Ollama, ...).
// Any AI failure falls back to the heuristic changelog - release never breaks.

const newVersion = process.argv[2] ?? "";
const prevTag = process.argv[3] ?? "";
const repo = process.env.GITHUB_REPOSITORY ?? "";
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_BASE_URL = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const LLM_MODEL = process.env.LLM_MODEL || "gpt-4o-mini";
const LANG = (process.env.RELEASE_NOTES_LANG || "en").toLowerCase() === "fa" ? "fa" : "en";

// ---------------------------------------------------------------- commits

const range = prevTag ? `${prevTag}..HEAD` : "";
let log = "";
try {
  log = execSync(`git log ${range} --pretty=format:%H%x1f%h%x1f%s`, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
} catch {
  log = "";
}

const commits = log
  ? log
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((entry) => {
        const [hash = "", sha = "", subject = ""] = entry.split("\x1f");
        return { hash: hash.trim(), sha: sha.trim(), subject: subject.trim() };
      })
      .filter((c) => c.sha && c.subject)
  : [];

// ------------------------------------------------------- heuristic rewrite

const SCOPE_LABELS = {
  epub: "EPUB",
  "epub-viewer": "EPUB reader",
  pdf: "PDF",
  markdown: "Markdown",
  translation: "Translation",
  "translation-images": "Translation images",
  reading: "Reading view",
  reader: "Reading view",
  home: "Library home",
  books: "Books",
  settings: "Settings",
  ai: "AI chat",
  "ai-chat": "AI chat",
  "open-with": "Open With",
  firstpagecover: "Cover",
  "reading-goal": "Reading goal",
};

// Scopes that are implementation details - never user-facing on their own.
const INTERNAL_SCOPES = new Set(["preload", "db", "store", "deps", "ci", "build", "deps-dev"]);

// Message smells like plumbing even when the scope sounds user-facing
// (e.g. "expose X via scrollHostRef"). These go under the hood.
const INTERNAL_KEYWORDS =
  /\b(ipc|scrollhostref|imperative handle|chatcompletion|force parameter|filestore|readerdefaults|barrel export|booksource|set-pinned)\b/i;

function parseConventional(subject) {
  const m = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/s);
  if (!m) return { type: "", scope: "", msg: subject };
  return { type: m[1].toLowerCase(), scope: (m[2] ?? "").toLowerCase(), msg: (m[4] ?? "").trim() };
}

function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Turn "add Pinned shelf with pin-unpin actions" into a scannable line.
function humanize(subject) {
  const { scope, msg } = parseConventional(subject);
  let text = capitalize(msg.replace(/\s+/g, " ").trim());
  const label = SCOPE_LABELS[scope];
  if (label) {
    // Avoid "EPUB reader: EPUB sanitization..." duplication.
    const firstWord = label.split(" ")[0].toLowerCase();
    if (!text.toLowerCase().includes(firstWord)) {
      text = `**${label}:** ${text}`;
    }
  } else if (scope && !INTERNAL_SCOPES.has(scope)) {
    const pretty = scope.replace(/-/g, " ");
    if (!text.toLowerCase().includes(pretty.split(" ")[0])) {
      text = `**${capitalize(pretty)}:** ${text}`;
    }
  }
  return text;
}

function heuristicGroup(c) {
  const { type, scope } = parseConventional(c.subject);
  if (INTERNAL_KEYWORDS.test(c.subject)) return "internal";
  if (["docs"].includes(type)) return "docs";
  if (["feat", "feature"].includes(type)) return INTERNAL_SCOPES.has(scope) ? "internal" : "features";
  if (["fix", "bug", "hotfix"].includes(type)) return "fixes";
  if (["perf"].includes(type)) return "improvements";
  if (["refactor", "style"].includes(type)) {
    return INTERNAL_SCOPES.has(scope) || !scope ? "internal" : "improvements";
  }
  if (["test", "chore", "build", "ci", "deps"].includes(type)) return "internal";
  return INTERNAL_SCOPES.has(scope) ? "internal" : "improvements";
}

const GROUP_META = {
  features: "### ✨ New features",
  fixes: "### 🐛 Bug fixes",
  improvements: "### ⚡ Improvements",
  docs: "### 📝 Documentation",
};

function fallbackSections() {
  const buckets = { features: [], fixes: [], improvements: [], docs: [], internal: [] };
  for (const c of commits) {
    const g = heuristicGroup(c);
    buckets[g].push(`- ${commitLink(repo, c.sha)} ${humanize(c.subject)}`);
  }
  const out = [];
  for (const key of ["features", "fixes", "improvements", "docs"]) {
    if (buckets[key].length > 0) out.push(GROUP_META[key], ...buckets[key], "");
  }
  if (buckets.internal.length > 0) {
    out.push(
      "<details>",
      "<summary>🔧 Under the hood (technical changes)</summary>",
      "",
      ...buckets.internal,
      "",
      "</details>",
      "",
    );
  }
  return out;
}

// ------------------------------------------------------------- AI rewrite

function linkifyAiBody(text) {
  // The Install section and compare link are added deterministically below,
  // so drop any model-invented tail to avoid duplicates.
  const cutAt = text.search(/^## 📥 Install|^\*\*Full Changelog\*\*/m);
  if (cutAt !== -1) text = text.slice(0, cutAt).trim();
  const bullets = text.split("\n").filter((l) => /^-\s*\[[0-9a-f]{7,40}\]/.test(l.trim()));
  if (bullets.length === 0) throw new Error("no `- [sha]` bullets in model response");
  return text.replace(/\[([0-9a-f]{7,40})\]/g, (_m, sha) => commitLink(repo, sha));
}

async function aiSections() {
  if (!LLM_API_KEY) throw new Error("LLM_API_KEY not set");
  const items = commits.map((c) => `[${c.sha}] ${c.subject}`).join("\n");
  const langName = LANG === "fa" ? "Persian (فارسی, friendly)" : "clear everyday English";

  const system = [
    "You write GitHub release notes for ReadLynx, a desktop reading app (PDF / EPUB / Markdown, translation, AI chat).",
    `Rewrite each technical commit into ONE short user-facing bullet in ${langName} that a non-programmer understands.`,
    "Rules: start every bullet with '- [SHORTSHA] ' using the EXACT short SHA from the input. Never invent or drop SHAs.",
    "One line per bullet, start with a verb, max ~18 words, no trailing period, no emojis inside bullets.",
    "Never mention IPC, SQLite columns, refs, prop names, or file internals as user benefits.",
    "Group under EXACTLY these headers (non-empty only, in order):",
    "### ✨ New features",
    "### 🐛 Bug fixes",
    "### ⚡ Improvements",
    "### 📝 Documentation",
    "Pure engineering work (CI, deps, refactors with no visible change) goes in a <details> block with summary '🔧 Under the hood (technical changes)'.",
    "Do NOT write a title header, an Install section, or a Full Changelog link. Output ONLY markdown.",
  ].join(" ");

  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LLM_API_KEY}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Rewrite these commits into release-note bullets:\n${items}` },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const data = await res.json();
  const text = (data?.choices?.[0]?.message?.content ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) throw new Error("empty model response");
  return linkifyAiBody(text).split("\n");
}

// ------------------------------------------------------------------ render

let sections;
try {
  sections = LLM_API_KEY && commits.length > 0 ? await aiSections() : fallbackSections();
} catch (err) {
  console.error(`LLM rewrite failed, using heuristic changelog: ${err?.message ?? err}`);
  sections = fallbackSections();
}

const header = newVersion ? `## 🚀 ReadLynx v${newVersion}` : "## What's Changed";
const parts = [header, ""];
if (commits.length === 0) {
  parts.push("No changes since the last release.", "");
} else {
  parts.push(...sections, "");
}
parts.push(...installSection(newVersion));

const compare = compareLine(repo, prevTag, newVersion);
if (compare) parts.push(compare);

console.log(parts.join("\n"));
