import { useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { EditorProvider } from "./EditorProvider";
import { Toolbar } from "./toolbar/Toolbar";
import { PLACEHOLDER_TEXT } from "./constants";
import type { EditorAPI } from "./types";
import styles from "./DocumentEditor.module.css";

export interface DocumentEditorProps {
  initialMarkdown?: string;
  editable?: boolean;
  apiRef?: RefObject<EditorAPI | null>;
  onSave?: () => void;
  className?: string;
}

export function DocumentEditor({
  initialMarkdown,
  editable = true,
  apiRef,
  onSave,
  className,
}: DocumentEditorProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [spacerHeight, setSpacerHeight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = (editorState: string) => {
    if (!fullscreen && rootRef.current) {
      setSpacerHeight(rootRef.current.offsetHeight);
    }
    setSnapshot(editorState);
    setFullscreen((prev) => !prev);
  };

  const rootClasses = [
    styles.root,
    className,
    fullscreen ? styles.fullscreen : "",
  ]
    .filter(Boolean)
    .join(" ");

  const editor = (
    <EditorProvider
      initialMarkdown={initialMarkdown}
      initialState={snapshot}
      editable={editable}
      apiRef={apiRef}
      onSave={onSave}
    >
      <Toolbar
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
      />
      <div className={styles.shell}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              aria-label="Document editor"
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
  );

  if (fullscreen) {
    return (
      <>
        {createPortal(<div className={rootClasses}>{editor}</div>, document.body)}
        <div
          className={styles.fullscreenSpacer}
          style={{ height: spacerHeight }}
          aria-hidden="true"
        />
      </>
    );
  }

  return (
    <div ref={rootRef} className={rootClasses}>
      {editor}
    </div>
  );
}
