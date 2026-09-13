import type { CSSProperties } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "../../../app/providers/theme/ThemeContext";
import type { MarkdownBlockTheme } from "../../../infrastructure/db/entities/ReaderSettings.ts";
import styles from "./Code.module.css";

interface CodeProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  className?: string;
  /** Fixed syntax theme; null/undefined = follow the app theme. */
  themeOverride?: MarkdownBlockTheme | null;
  /** Fixed block background; null/undefined = follow the theme card. */
  background?: string | null;
}

export function Code({
  code,
  language = "typescript",
  showLineNumbers = false,
  className = "",
  themeOverride,
  background,
}: CodeProps) {
  const { theme } = useTheme();
  const effective = themeOverride ?? theme;
  const prismStyle = effective === "dark" ? oneDark : oneLight;
  const classes = [styles.host, className].filter(Boolean).join(" ");

  const customStyle: CSSProperties = {
    margin: 0,
    padding: "var(--space-4) var(--space-5)",
    background: "transparent",
    fontSize: "13px",
    lineHeight: 1.6,
  };

  const hostStyle: CSSProperties | undefined = background
    ? { backgroundColor: background }
    : undefined;

  return (
    <div className={classes} style={hostStyle}>
      <SyntaxHighlighter
        language={language}
        style={prismStyle}
        showLineNumbers={showLineNumbers}
        customStyle={customStyle}
        codeTagProps={{ style: { fontFamily: "inherit" } }}
      >
        {code.trimEnd()}
      </SyntaxHighlighter>
    </div>
  );
}
