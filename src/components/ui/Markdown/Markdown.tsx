import { isValidElement } from "react";
import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { Check } from "lucide-react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import "katex/dist/katex.min.css";
import { Code } from "../Code/Code";
import { Image } from "../Image/Image";
import { List } from "../List/List";
import type { ListItemData } from "../List/List";
import { Mermaid } from "../Mermaid/Mermaid";
import { Table } from "../Table/Table";
import type { TableColumn } from "../Table/Table";
import styles from "./Markdown.module.css";

interface MarkdownProps {
  content: string;
  className?: string;
}

/* ---------- RTL helpers ---------- */

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    const props = (node.props as { children?: ReactNode }) ?? {};
    if (props.children) return extractText(props.children);
  }
  return "";
}

function isRtlCodePoint(cp: number): boolean {
  return (
    (cp >= 0x0590 && cp <= 0x05ff) || // Hebrew
    (cp >= 0x0600 && cp <= 0x06ff) || // Arabic
    (cp >= 0x0750 && cp <= 0x077f) || // Arabic Supplement
    (cp >= 0xfb50 && cp <= 0xfdff) || // Arabic Presentation Forms-A
    (cp >= 0xfe70 && cp <= 0xfeff) // Arabic Presentation Forms-B
  );
}

function isArabicDigit(cp: number): boolean {
  return (
    (cp >= 0x0660 && cp <= 0x0669) || // Arabic-Indic digits ٠-٩
    (cp >= 0x06f0 && cp <= 0x06f9) // Extended Arabic-Indic (Persian) digits ۰-۹
  );
}

// Direction is decided by the DOMINANT language of the prose, counted per WORD
// rather than per letter, so a long Latin token can't drown out several short
// Persian words. Digits, spaces and punctuation are neutral and don't vote.
function classifyWord(word: string): "rtl" | "ltr" | undefined {
  for (const ch of word) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isArabicDigit(cp)) continue; // Arabic/Persian digits are neutral
    if (isRtlCodePoint(cp)) return "rtl";
    if (/[a-zA-Z]/.test(ch)) return "ltr";
  }
  return undefined; // only digits/symbols -> neutral
}

function getDir(node: ReactNode): "rtl" | "ltr" | undefined {
  const text = extractText(node);
  let rtlWords = 0;
  let ltrWords = 0;

  for (const raw of text.split(/\s+/)) {
    if (!raw) continue;
    const cls = classifyWord(raw);
    if (cls === "rtl") rtlWords++;
    else if (cls === "ltr") ltrWords++;
  }

  if (rtlWords > ltrWords) return "rtl";
  if (ltrWords > rtlWords) return "ltr";

  // Equal or no words: decide by first strong letter
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isArabicDigit(cp)) continue;
    if (isRtlCodePoint(cp)) return "rtl";
    if (/[a-zA-Z]/.test(ch)) return "ltr";
  }
  return undefined;
}

function dirProps(node: ReactNode): { dir?: "rtl" | "ltr"; style?: CSSProperties } {
  const dir = getDir(node);
  return {
    ...(dir ? { dir } : {}),
    ...(dir === "rtl" ? { style: { textAlign: "right" } } : {}),
  };
}

interface MdNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MdNode[];
}

function toMdNode(value: unknown): MdNode | null {
  if (value && typeof value === "object") return value as MdNode;
  return null;
}

function mdText(node: MdNode | null): string {
  if (!node) return "";
  if (node.type === "text" || node.type === "raw") return node.value ?? "";
  return (node.children ?? []).map((child) => mdText(child)).join("");
}

function textContent(children: ReactNode): string {
  return Array.isArray(children) ? children.join("") : String(children ?? "");
}

function listItems(node: unknown): ListItemData[] {
  return (toMdNode(node)?.children ?? [])
    .filter((child) => child.type === "element")
    .map((item, index) => {
      const label = mdText(item);
      return { id: `md-li-${index}`, label, dir: getDir(label) };
    });
}

function isTaskList(node: unknown): boolean {
  return (toMdNode(node)?.children ?? []).some((item) =>
    (item.children ?? []).some((child) => toMdNode(child)?.tagName === "input"),
  );
}

function taskList(node: unknown) {
  const items = (toMdNode(node)?.children ?? []).filter(
    (child) => child.type === "element",
  );
  return (
    <ul className={styles.tasks}>
      {items.map((item, index) => {
        const checkbox = (item.children ?? []).find(
          (child) => toMdNode(child)?.tagName === "input",
        );
        const checked = toMdNode(checkbox)?.properties?.checked === true;
        return (
          <li key={index} className={styles.taskItem}>
            <span className={styles.taskBox} aria-hidden="true">
              {checked && <Check size={12} strokeWidth={2.5} />}
            </span>
            <span {...dirProps(mdText(item))}>{mdText(item)}</span>
          </li>
        );
      })}
    </ul>
  );
}

const components: Components = {
  h1: ({ children, node: _node, ...props }) => (
    <h1 className={styles.h1} {...props} {...dirProps(children)}>
      {children}
    </h1>
  ),
  h2: ({ children, node: _node, ...props }) => (
    <h2 className={styles.h2} {...props} {...dirProps(children)}>
      {children}
    </h2>
  ),
  h3: ({ children, node: _node, ...props }) => (
    <h3 className={styles.h3} {...props} {...dirProps(children)}>
      {children}
    </h3>
  ),
  h4: ({ children, node: _node, ...props }) => (
    <h4 className={styles.h4} {...props} {...dirProps(children)}>
      {children}
    </h4>
  ),
  div: ({ children, node: _node, ...props }) => (
    <div {...props} {...dirProps(children)}>
      {children}
    </div>
  ),
  span: ({ children, node: _node, ...props }) => (
    <span {...props} {...dirProps(children)}>
      {children}
    </span>
  ),
  p: ({ children, node: _node, ...props }) => {
    const kids = Array.isArray(children) ? children : [children];
    const mathOnly =
      kids.length > 0 &&
      kids.every(
        (child) =>
          isValidElement(child) &&
          String((child.props as { className?: unknown })?.className ?? "").includes("katex"),
      );
    return (
      <p
        className={styles.p}
        {...props}
        {...dirProps(children)}
        style={mathOnly ? { textAlign: "center" } : undefined}
      >
        {children}
      </p>
    );
  },
  a: ({ href, children }) => (
    <a href={href} className={styles.link} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  ul: ({ node }) => (isTaskList(node) ? taskList(node) : <List items={listItems(node)} />),
  ol: ({ node }) => <List items={listItems(node)} />,
  blockquote: ({ children, node: _node, ...props }) => (
    <blockquote className={styles.blockquote} {...props} {...dirProps(children)}>
      {children}
    </blockquote>
  ),
  hr: () => <hr className={styles.hr} />,
  img: ({ src, alt }) => (
    <Image src={src} alt={alt ?? "Image"} aspectRatio="16 / 9" />
  ),
  code: ({ className, children }) => {
    const match = /language-(\w+)/.exec(className ?? "");
    if (match) {
      if (match[1] === "mermaid") {
        return <Mermaid code={textContent(children)} />;
      }
      return <Code code={textContent(children)} language={match[1]} />;
    }
    return <code className={styles.inlineCode}>{children}</code>;
  },
  pre: ({ children }) => <>{children}</>,
  table: ({ node, children }) => {
    const root = toMdNode(node);
    const thead = (root?.children ?? []).find((child) => child.tagName === "thead");
    const tbody = (root?.children ?? []).find((child) => child.tagName === "tbody");
    const headers = (thead?.children?.[0]?.children ?? []).map((cell) =>
      mdText(cell).trim(),
    );
    const rows = (tbody?.children ?? [])
      .filter((row) => toMdNode(row)?.tagName === "tr")
      .map((row) =>
        (toMdNode(row)?.children ?? []).map((cell) => mdText(cell).trim()),
      );
    const columns: TableColumn<string[]>[] = headers.map((header, index) => ({
      key: `md-col-${index}`,
      header,
      headerDir: getDir(header),
      render: (row) => {
        const cell = row[index] ?? "";
        return (
          <span dir={getDir(cell)} style={getDir(cell) === "rtl" ? { textAlign: "right" } : undefined}>
            {cell}
          </span>
        );
      },
    }));
    if (columns.length === 0) return <table>{children}</table>;
    return <Table columns={columns} rows={rows} />;
  },
};

export function Markdown({ content, className = "" }: MarkdownProps) {
  const classes = [styles.host, className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
