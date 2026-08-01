import type { CSSProperties } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "../../../app/providers/theme/ThemeContext";
import styles from "./Code.module.css";

interface CodeProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  className?: string;
}

export function Code({
  code,
  language = "typescript",
  showLineNumbers = false,
  className = "",
}: CodeProps) {
  const { theme } = useTheme();
  const prismStyle = theme === "dark" ? oneDark : oneLight;
  const classes = [styles.host, className].filter(Boolean).join(" ");

  const customStyle: CSSProperties = {
    margin: 0,
    padding: "var(--space-4) var(--space-5)",
    background: "transparent",
    fontSize: "13px",
    lineHeight: 1.6,
  };

  return (
    <div className={classes}>
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
