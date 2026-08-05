import hljs from "highlight.js/lib/common";
import powershell from "highlight.js/lib/languages/powershell";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import http from "highlight.js/lib/languages/http";
import scala from "highlight.js/lib/languages/scala";
import githubDarkCss from "highlight.js/styles/github-dark.min.css?raw";

/*
 * Syntax highlighting for EPUB export.
 *
 * `$generateHtmlFromNodes` serializes Lexical code blocks as
 * `<pre spellcheck="false" data-language="js">…</pre>` containing escaped
 * text and `<br>` line breaks. This module post-processes that HTML: every
 * `<pre>` is re-emitted as `<pre><code class="language-… hljs">…</code></pre>`
 * with Highlight.js token spans, so the EPUB contains only static XHTML and
 * the bundled theme CSS — no runtime JavaScript.
 */

hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("http", http);
hljs.registerLanguage("scala", scala);

const PRE_OPEN_RE = /<pre\b[^>]*>/gi;
const PRE_CLOSE_RE = /<\/pre>/i;
const BR_RE = /<br\s*\/?>/gi;
const ANY_TAG_RE = /<[^>]+>/g;
const LANG_ATTR_RE = /\bdata-language=["']([^"']*)["']/i;

/** Lexical/Prism language names that Highlight.js doesn't know directly. */
const LEXICAL_TO_HLJS: Record<string, string> = {
  plain: "plaintext",
  text: "plaintext",
  "plain text": "plaintext",
};

/** Decodes the XML-escaped text emitted by the DOM serializer. */
function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Replaces one `<pre>` block with a Highlight.js-highlighted version. */
function buildHighlightedCodeBlock(openTag: string, rawContent: string): string {
  const text = decodeEntities(rawContent.replace(BR_RE, "\n").replace(ANY_TAG_RE, ""));
  const langMatch = LANG_ATTR_RE.exec(openTag);
  const rawLang = (langMatch ? langMatch[1] : "").trim().toLowerCase();
  const language = LEXICAL_TO_HLJS[rawLang] ?? rawLang;

  let value: string;
  let detected = "";
  try {
    if (language) {
      if (hljs.getLanguage(language)) {
        const result = hljs.highlight(text, { language, ignoreIllegals: true });
        value = result.value;
        detected = result.language ?? language;
      } else {
        value = escapeHtml(text);
      }
    } else {
      const result = hljs.highlightAuto(text);
      value = result.value;
      detected = result.language ?? "";
    }
  } catch {
    value = escapeHtml(text);
  }

  const codeClass = detected ? `language-${detected} hljs` : "hljs";
  return `<pre${openTag.slice(4)}<code class="${codeClass}">${value}</code></pre>`;
}

/**
 * Runs Highlight.js over every `<pre>` block in the generated body HTML.
 * Returns the same HTML with code blocks wrapped in highlighted
 * `<code class="language-… hljs">` elements.
 */
export function highlightBodyCode(bodyHtml: string): string {
  let result = "";
  let lastIndex = 0;
  PRE_OPEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PRE_OPEN_RE.exec(bodyHtml)) !== null) {
    const openTag = match[0];
    const contentStart = match.index + openTag.length;
    const closeMatch = PRE_CLOSE_RE.exec(bodyHtml.slice(contentStart));
    if (!closeMatch) break;
    const contentEnd = contentStart + closeMatch.index;
    const closeEnd = contentEnd + closeMatch[0].length;
    result += bodyHtml.slice(lastIndex, match.index);
    result += buildHighlightedCodeBlock(openTag, bodyHtml.slice(contentStart, contentEnd));
    lastIndex = closeEnd;
    PRE_OPEN_RE.lastIndex = closeEnd;
  }
  result += bodyHtml.slice(lastIndex);
  return result;
}

/**
 * Highlight.js theme CSS for the book (GitHub Dark), plus small EPUB-safe
 * adjustments: wrapping instead of horizontal scroll, and keeping code
 * blocks on one page.
 */
export const HIGHLIGHT_THEME_CSS = `${githubDarkCss}
pre {
  padding: 0;
  background: transparent;
  break-inside: avoid;
  page-break-inside: avoid;
}
pre code.hljs {
  display: block;
  padding: 0.8em;
  overflow-x: visible;
  white-space: pre-wrap;
}`;
