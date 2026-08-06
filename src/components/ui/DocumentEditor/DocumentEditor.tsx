import { useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { createPortal } from "react-dom";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { EditorProvider } from "./EditorProvider";
import { Toolbar } from "./toolbar/Toolbar";
import { PAGE_FORMATS, PAGE_MARGIN_MM, uniformMargins, marginPx, PLACEHOLDER_TEXT } from "./constants";
import type { PageFormat, PageMargins } from "./constants";
import type { EditorAPI } from "./types";
import styles from "./DocumentEditor.module.css";

export interface DocumentEditorProps {
  initialMarkdown?: string;
  /** Serialized editor state (JSON). Takes precedence over `initialMarkdown`. */
  initialState?: string;
  editable?: boolean;
  apiRef?: RefObject<EditorAPI | null>;
  onSave?: () => void | Promise<void>;
  onChange?: (json: string) => void;
  className?: string;
  paged?: boolean;
  pageFormat?: PageFormat;
  margins?: PageMargins;
  onMarginsChange?: (margins: PageMargins) => void;
  /** Document-wide font used for text without an explicit font. */
  defaultFontFamily?: string;
  onDefaultFontFamilyChange?: (family: string) => void;
  zoom?: number;
  onPageCountChange?: (count: number) => void;
  onWordCountChange?: (count: number) => void;
  searchQuery?: string;
  searchActiveIndex?: number;
  onSearchResultCount?: (count: number) => void;
  /** Called after the initial content has been applied to the editor. */
  onInitialContentLoaded?: () => void;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

export function DocumentEditor({
  initialMarkdown,
  initialState,
  editable = true,
  apiRef,
  onSave,
  onChange,
  className,
  paged = false,
  pageFormat = "a4",
  margins,
  onMarginsChange,
  defaultFontFamily,
  onDefaultFontFamilyChange,
  zoom = 1,
  onPageCountChange,
  onWordCountChange,
  searchQuery,
  searchActiveIndex,
  onSearchResultCount,
  onInitialContentLoaded,
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
  const pageMargins = margins ?? uniformMargins(PAGE_MARGIN_MM);
  const marginTopPx = marginPx(pageMargins.top);
  const marginRightPx = marginPx(pageMargins.right);
  const marginBottomPx = marginPx(pageMargins.bottom);
  const marginLeftPx = marginPx(pageMargins.left);
  const marginYPx = Math.round((marginTopPx + marginBottomPx) / 2);
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
                  paddingTop: `${marginTopPx}px`,
                  paddingLeft: `${marginLeftPx}px`,
                  paddingRight: `${marginRightPx}px`,
                  paddingBottom: `${marginBottomPx}px`,
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
      initialState={snapshot ?? initialState}
      editable={editable}
      apiRef={apiRef}
      onSave={onSave}
      onChange={onChange}
      initialDefaultFontFamily={defaultFontFamily}
      onDefaultFontFamilyChange={onDefaultFontFamilyChange}
      paged={paged}
      pageFormat={pageFormat}
      zoom={clampedZoom}
      marginY={marginYPx}
      onPageCountChange={onPageCountChange}
      onWordCountChange={onWordCountChange}
      searchQuery={searchQuery}
      searchActiveIndex={searchActiveIndex}
      onSearchResultCount={onSearchResultCount}
      onInitialContentLoaded={onInitialContentLoaded}
    >
      <Toolbar
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        paged={paged}
        pageFormat={pageFormat}
        margins={pageMargins}
        onMarginsChange={onMarginsChange}
        onSave={onSave}
      />
      {paged && (
        <style>{`@page { size: ${PAGE_FORMATS[pageFormat].cssSize}; margin: ${pageMargins.top}mm ${pageMargins.right}mm ${pageMargins.bottom}mm ${pageMargins.left}mm; }`}</style>
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
                  "--page-margin-top": `${marginTopPx}px`,
                  "--page-margin-right": `${marginRightPx}px`,
                  "--page-margin-bottom": `${marginBottomPx}px`,
                  "--page-margin-left": `${marginLeftPx}px`,
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
