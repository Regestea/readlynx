import { useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { createPortal } from "react-dom";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { EditorProvider } from "./EditorProvider";
import { Toolbar } from "./toolbar/Toolbar";
import { PAGE_FORMATS, PAGE_MARGIN_MM, marginPx, PLACEHOLDER_TEXT } from "./constants";
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
  marginMm?: number;
  onMarginChange?: (margin: number) => void;
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
  marginMm,
  onMarginChange,
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
  const pageMarginMm = marginMm ?? PAGE_MARGIN_MM;
  const pageMarginPx = marginPx(pageMarginMm);
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
                  paddingTop: `${pageMarginPx}px`,
                  paddingLeft: `${pageMarginPx}px`,
                  paddingRight: `${pageMarginPx}px`,
                  paddingBottom: `${pageMarginPx}px`,
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
      marginY={pageMarginPx}
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
        marginMm={pageMarginMm}
        onMarginChange={onMarginChange}
      />
      {paged && (
        <style>{`@page { size: ${PAGE_FORMATS[pageFormat].cssSize}; margin: ${pageMarginMm}mm; }`}</style>
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
                  "--page-margin-x": `${pageMarginPx}px`,
                  "--page-margin-y": `${pageMarginPx}px`,
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
