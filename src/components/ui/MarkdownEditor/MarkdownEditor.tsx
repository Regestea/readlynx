import { useState } from "react";
import type { RefObject } from "react";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { EditorProvider } from "./EditorProvider";
import { Toolbar } from "./toolbar/Toolbar";
import { PLACEHOLDER_TEXT } from "./constants";
import type { EditorAPI } from "./types";
import styles from "./MarkdownEditor.module.css";

export interface MarkdownEditorProps {
  initialMarkdown?: string;
  editable?: boolean;
  apiRef?: RefObject<EditorAPI | null>;
  onSave?: () => void;
  className?: string;
}

export function MarkdownEditor({
  initialMarkdown,
  editable = true,
  apiRef,
  onSave,
  className,
}: MarkdownEditorProps) {
  const [focus, setFocus] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [dark, setDark] = useState(false);

  const rootClasses = [
    styles.root,
    className,
    focus ? styles.focusMode : "",
    fullscreen ? styles.fullscreen : "",
    dark ? styles.darkMode : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClasses}>
      <EditorProvider initialMarkdown={initialMarkdown} editable={editable} apiRef={apiRef} onSave={onSave}>
        <Toolbar
          focus={focus}
          fullscreen={fullscreen}
          dark={dark}
          onToggleFocus={() => setFocus((prev) => !prev)}
          onToggleFullscreen={() => setFullscreen((prev) => !prev)}
          onToggleDark={() => setDark((prev) => !prev)}
        />
        <div className={styles.shell}>
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                aria-label="Markdown editor"
                aria-placeholder={PLACEHOLDER_TEXT}
                placeholder={<div className={styles.placeholder}>{PLACEHOLDER_TEXT}</div>}
                className={styles.contentEditable}
                spellCheck
              />
            }
            placeholder={<div className={styles.placeholder}>{PLACEHOLDER_TEXT}</div>}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
      </EditorProvider>
    </div>
  );
}
