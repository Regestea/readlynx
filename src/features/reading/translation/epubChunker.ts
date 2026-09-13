/**
 * Splits a chapter's Markdown into translation-sized requests.
 *
 * Strategy:
 * - Sections are cut at heading lines (`#`…`######`), so semantic units
 *   (heading + its content) never split across requests.
 * - Tiny sections merge with the following ones until a chunk is at least
 *   `MIN_CHUNK` characters (≈ one page), and a chunk never grows past
 *   `MAX_CHUNK` — small chapters become a single request.
 * - A single oversized section is split at paragraph boundaries (never in
 *   the middle of a paragraph, list, table or code block), with a hard
 *   fallback that truncates pathological single paragraphs. A buffer below
 *   `MIN_CHUNK` (e.g. a lone heading line) is never split off on its own.
 * - A final pass glues any leftover tiny fragment into a neighbor, so no AI
 *   request is wasted on a context-free sliver.
 *
 * The output depends only on the chapter content, so chunk boundaries (and
 * therefore cache keys) are stable across runs.
 */

const MIN_CHUNK = 1500;
const MAX_CHUNK = 6000;
const HARD_MAX = 12000;

const HEADING_RE = /^(#{1,6})\s+\S.*$/;

interface Section {
  /** The heading line (without leading `#`s) or null for a preamble. */
  heading: string | null;
  level: number;
  content: string;
  size: number;
}

/** Splits markdown into sections at heading lines; the preamble (text before
 *  the first heading) becomes an unheaded section. */
function toSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;

  const push = () => {
    if (!current) return;
    current.size = current.content.length;
    sections.push(current);
    current = null;
  };

  for (const line of lines) {
    const match = line.match(HEADING_RE);
    if (match) {
      push();
      current = {
        heading: line.replace(/^#{1,6}\s+/, "").trim(),
        level: match[1].length,
        content: line,
        size: 0,
      };
    } else {
      if (!current) {
        current = { heading: null, level: 0, content: "", size: 0 };
      }
      current.content += (current.content ? "\n" : "") + line;
    }
  }
  push();
  return sections;
}

/** Splits an oversized section at paragraph boundaries (blank lines). A
 *  buffer below `MIN_CHUNK` (e.g. a lone heading line) is never split off on
 *  its own — it stays glued to the following paragraphs so no AI request is
 *  wasted on a tiny fragment without context. */
function splitSectionByParagraphs(section: Section): string[] {
  const paragraphs = section.content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const parts: string[] = [];
  let buffer = "";
  for (const paragraph of paragraphs) {
    if (buffer && buffer.length + paragraph.length + 2 > MAX_CHUNK && buffer.length >= MIN_CHUNK) {
      parts.push(buffer);
      buffer = paragraph;
    } else {
      buffer += (buffer ? "\n\n" : "") + paragraph;
    }
  }
  if (buffer) parts.push(buffer);
  if (parts.length === 0) parts.push(section.content);
  return parts.map((part) => (part.length > HARD_MAX ? `${part.slice(0, HARD_MAX)}…` : part));
}

/** Merges sections into chunks: keep merging while the chunk is below the
 *  target size, but never let a single request exceed `MAX_CHUNK`. */
function mergeSections(sections: Section[]): string[] {
  const chunks: string[] = [];
  let buffer = "";
  let bufferSize = 0;

  const flush = () => {
    if (!buffer) return;
    chunks.push(buffer);
    buffer = "";
    bufferSize = 0;
  };

  for (const section of sections) {
    if (section.size >= MAX_CHUNK) {
      // The oversized section may share a chunk with a small buffer, then
      // gets split on its own. Splitting loses the heading for each part.
      flush();
      chunks.push(...splitSectionByParagraphs(section));
      continue;
    }
    const withNext = bufferSize + section.size;
    if (buffer && withNext > MAX_CHUNK && bufferSize >= MIN_CHUNK) {
      flush();
    }
    buffer += (buffer ? "\n\n" : "") + section.content;
    bufferSize = withNext;
  }
  flush();
  return chunks;
}

/** Merges tiny fragments (below `MIN_CHUNK`) into a neighbor so no AI request
 *  is wasted on a context-free sliver (a lone heading, a short tail section,
 *  …). A merge only happens when the combination still fits comfortably
 *  (under `HARD_MAX`); pathological leftovers stay separate. Merging is
 *  backward (into the previous chunk), except a tiny leading chunk which
 *  naturally glues forward into whatever follows it. */
function mergeTinyChunks(chunks: string[]): string[] {
  const out: string[] = [];
  for (const chunk of chunks) {
    const prev = out[out.length - 1];
    if (
      prev !== undefined &&
      (prev.length < MIN_CHUNK || chunk.length < MIN_CHUNK) &&
      prev.length + chunk.length + 2 <= HARD_MAX
    ) {
      out[out.length - 1] = `${prev}\n\n${chunk}`;
    } else {
      out.push(chunk);
    }
  }
  return out;
}

/** Chunks a chapter into AI-request-sized pieces (see module comment). */
export function chunkChapter(markdown: string): string[] {
  const trimmed = markdown.trim();
  if (!trimmed) return [];
  if (trimmed.length <= MAX_CHUNK) return [trimmed];
  return mergeTinyChunks(mergeSections(toSections(trimmed)));
}