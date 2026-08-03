import { useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { createPortal } from "react-dom";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { EditorProvider } from "./EditorProvider";
import { Toolbar } from "./toolbar/Toolbar";
import { PAGE_FORMATS, PAGE_MARGIN_MM, PAGE_MARGIN_X, PAGE_MARGIN_Y, PLACEHOLDER_TEXT } from "./constants";
import type { PageFormat } from "./constants";
import type { EditorAPI } from "./types";
import styles from "./DocumentEditor.module.css";

export interface DocumentEditorProps {
  initialMarkdown?: string;
  editable?: boolean;
  apiRef?: RefObject<EditorAPI | null>;
  onSave?: () => void;
  onChange?: (json: string) => void;
  className?: string;
  paged?: boolean;
  pageFormat?: PageFormat;
  zoom?: number;
  onPageCountChange?: (count: number) => void;
  onWordCountChange?: (count: number) => void;
  searchQuery?: string;
  searchActiveIndex?: number;
  onSearchResultCount?: (count: number) => void;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

export function DocumentEditor({
  initialMarkdown,
  editable = true,
  apiRef,
  onSave,
  onChange,
  className,
  paged = false,
  pageFormat = "a4",
  zoom = 1,
  onPageCountChange,
  onWordCountChange,
  searchQuery,
  searchActiveIndex,
  onSearchResultCount,
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
    paged ? styles.paged : "",
  ]
    .filter(Boolean)
    .join(" ");

  const { width: pageWidth, height: pageHeight } = PAGE_FORMATS[pageFormat];
  const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

  const placeholderElement = (
    <div className={`${styles.placeholder} ${paged ? styles.placeholderPaged : ""}`}>
      {PLACEHOLDER_TEXT}
    </div>
  );

  const surface = (
    <RichTextPlugin
      contentEditable={
        <ContentEditable
          aria-label="Document editor"
          aria-placeholder={PLACEHOLDER_TEXT}
          placeholder={placeholderElement}
          className={paged ? styles.contentEditablePaged : styles.contentEditable}
          style={
            paged
              ? ({
                  minHeight: pageHeight,
                  paddingTop: `${PAGE_MARGIN_Y}px`,
                  paddingLeft: `${PAGE_MARGIN_X}px`,
                  paddingRight: `${PAGE_MARGIN_X}px`,
                  paddingBottom: `${PAGE_MARGIN_Y}px`,
                } as CSSProperties)
              : undefined
          }
          spellCheck
        />
      }
      placeholder={placeholderElement}
      ErrorBoundary={LexicalErrorBoundary}
    />
  );

  const editor = (
    <EditorProvider
      initialMarkdown={initialMarkdown}
      initialState={snapshot}
      editable={editable}
      apiRef={apiRef}
      onSave={onSave}
      onChange={onChange}
      paged={paged}
      pageFormat={pageFormat}
      zoom={clampedZoom}
      onPageCountChange={onPageCountChange}
      onWordCountChange={onWordCountChange}
      searchQuery={searchQuery}
      searchActiveIndex={searchActiveIndex}
      onSearchResultCount={onSearchResultCount}
    >
      <Toolbar
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        paged={paged}
        pageFormat={pageFormat}
      />
      {paged && (
        <style>{`@page { size: ${PAGE_FORMATS[pageFormat].cssSize}; margin: ${PAGE_MARGIN_MM}mm; }`}</style>
      )}
      {paged ? (
        <div className={styles.shellPaged}>
          <div className={styles.pagedStage}>
            <div
              className={styles.pagedPaper}
              style={
                {
                  width: pageWidth,
                  zoom: clampedZoom,
                  "--page-margin-x": `${PAGE_MARGIN_X}px`,
                  "--page-margin-y": `${PAGE_MARGIN_Y}px`,
                } as CSSProperties
              }
            >
              {surface}
              <div
                className={styles.pageBoundaries}
                data-page-boundaries="true"
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.shell}>{surface}</div>
      )}
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
