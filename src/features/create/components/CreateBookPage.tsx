import { useState } from "react";
import { AlignJustify, ArrowLeft, BookOpen, ChevronDown, ChevronUp, FileText, Search, X, ZoomIn, ZoomOut } from "lucide-react";
import { DocumentEditor } from "../../../components/ui/DocumentEditor";
import { Button } from "../../../components/ui/Button/Button";
import { Select } from "../../../components/ui/Select/Select";
import { ZOOM_OPTIONS, PAGE_FORMATS, PAGE_MARGIN_MM, uniformMargins } from "../../../components/ui/DocumentEditor/constants";
import type { PageFormat, PageMargins } from "../../../components/ui/DocumentEditor/constants";
import styles from "./CreateBookPage.module.css";

interface CreateBookPageProps {
  onBack?: () => void;
}

const SAMPLE_BOOK = `# The Mountain Keep

A novel in progress — every chapter flows onto the next page as you write.

## Chapter One — The Ascent

The road to High Pass begins as a thread of grey beside the river, then climbs until the pines thin and the air turns sharp as flint.

Mara pulled her hood tight and counted her steps the way her grandmother had taught her. One for the heart. Two for the hearth. Three for the road that never ends. By the time she reached the old watchtower, the valley below had folded itself into a blanket of cloud.

She had never been this high before. The keep stood where the two ridgelines met, its stones older than the trees, older than the names carved into the gate.

> A mountain is not climbed. It is kept, until it keeps you.

The keeper's door was ajar. Inside, a fire burned low, and an old woman sat among maps that covered every wall like snowfall.

"You have come," the woman said, without looking up. "Good. There is little time."

## Chapter Two — The Cartographer's Room

The maps were not maps of places. Mara realized this slowly, the way one realizes a dream is a memory turned inside out. Rivers flowed between years. A road labelled *Harvest* passed through a city that had not been built, and a port called *Goodbye* sat on a shore that had drowned a century ago.

"Every line is a life," the keeper said. "Every fold in the parchment, a choice. When the ink dries, the choice is made."

Mara touched the edge of a chart that showed her own village. There, a small circle of ink marked the square where her grandmother had told stories by the fountain. She felt the paper grow warm under her fingertips.

## Chapter Three — The Fire

That night the wind changed. It came down from the peaks in a single breath, and with it came the sound of bells — not from the valley, but from the sky.

"The Keep has many names," the keeper whispered. "Tonight it is called the Alarm."

Mara watched the fire-light dance across the maps. The ink was moving. Lines were redrawing themselves, rivers bending toward the mountain, roads turning to spiral.

### What she found at the threshold

Beyond the gate, the night was not dark. It was *bright*, brighter than noon, and in that brightness stood a figure woven from light and snow.

"Do you know what a story is?" the figure asked. "It is a promise. And every promise is a door."

Mara thought of her grandmother. Of the hearth. Of the road.

"Then I will walk through it," she said.

- The first promise was kept at dawn.
- The second was kept at the river.
- The third is kept still — by whoever reads this page.

## Chapter Four — Unwritten

The keeper gave her a single blank sheet. "This is the last map," she said. "Write your own place on it. Not the place you came from, but the place you will become."

Mara took the sheet. Outside, the snow had stopped. The valley was green again.

She wrote one word.

*Home.*

The ink glowed once, softly, like a fire remembering how to burn.

And somewhere far below, in a village by a fountain, a grandmother looked up from her stories and smiled — as if she had always known her granddaughter would one day walk through a door of light.

The End.`;

export function CreateBookPage({ onBack }: CreateBookPageProps) {
  const [zoomIndex, setZoomIndex] = useState(2);
  const [layout, setLayout] = useState<"paged" | "continuous">("paged");
  const [pageFormat, setPageFormat] = useState<PageFormat>("a4");
  const [margins, setMargins] = useState<PageMargins>(() => uniformMargins(PAGE_MARGIN_MM));
  const [pages, setPages] = useState(1);
  const [words, setWords] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchCount, setSearchCount] = useState(0);

  const zoom = ZOOM_OPTIONS[Math.min(ZOOM_OPTIONS.length - 1, Math.max(0, zoomIndex))];

  const goToMatch = (delta: number) => {
    if (searchCount <= 0) return;
    setSearchIndex((index) => (index + delta + searchCount) % searchCount);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      goToMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      setSearchQuery("");
      setSearchIndex(0);
    }
  };

  return (
    <main className={styles.page} aria-label="Create book">
      <header className={`${styles.topBar} animate-fade-up`}>
        <Button variant="icon" className={styles.backButton} aria-label="Back to home" onClick={onBack}>
          <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
        </Button>

        <div className={styles.searchBox}>
          <Search size={15} strokeWidth={1.8} className={styles.searchIcon} aria-hidden="true" />
          <input
            type="text"
            className={styles.searchInput}
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setSearchIndex(0);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search the document"
            aria-label="Search the document"
          />
          {searchQuery && (
            <>
              <span className={styles.searchCount}>
                {searchCount > 0 ? `${searchIndex + 1} / ${searchCount}` : "0"}
              </span>
              <button
                type="button"
                className={styles.searchNav}
                onClick={() => goToMatch(-1)}
                aria-label="Previous match"
                disabled={searchCount === 0}
              >
                <ChevronUp size={14} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={styles.searchNav}
                onClick={() => goToMatch(1)}
                aria-label="Next match"
                disabled={searchCount === 0}
              >
                <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={styles.searchNav}
                onClick={() => {
                  setSearchQuery("");
                  setSearchIndex(0);
                }}
                aria-label="Clear search"
              >
                <X size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            </>
          )}
        </div>

        <div className={styles.stats} aria-label="Book statistics">
          {layout === "paged" && (
            <span className={styles.stat}>
              <FileText size={14} strokeWidth={1.8} aria-hidden="true" />
              {pages} {pages === 1 ? "page" : "pages"}
            </span>
          )}
          <span className={styles.stat}>{words.toLocaleString()} words</span>
        </div>

        <div className={styles.layout} role="group" aria-label="Layout">
          <button
            type="button"
            className={`${styles.layoutButton} ${layout === "paged" ? styles.layoutButtonActive : ""}`}
            aria-pressed={layout === "paged"}
            onClick={() => setLayout("paged")}
            title="Show the document as separate pages"
          >
            <BookOpen size={15} strokeWidth={1.8} aria-hidden="true" />
            Pages
          </button>
          <button
            type="button"
            className={`${styles.layoutButton} ${layout === "continuous" ? styles.layoutButtonActive : ""}`}
            aria-pressed={layout === "continuous"}
            onClick={() => setLayout("continuous")}
            title="Show the document as one continuous page"
          >
            <AlignJustify size={15} strokeWidth={1.8} aria-hidden="true" />
            Continuous
          </button>
        </div>

        {layout === "paged" && (
          <Select
            className={styles.pageSizeSelect}
            aria-label="Page size"
            value={pageFormat}
            onChange={(event) => setPageFormat(event.target.value as PageFormat)}
            options={Object.entries(PAGE_FORMATS).map(([value, info]) => ({
              value,
              label: info.label,
            }))}
          />
        )}

        <div className={styles.zoom} role="group" aria-label="Zoom">
          <Button
            variant="icon"
            className={styles.zoomButton}
            aria-label="Zoom out"
            disabled={zoomIndex === 0}
            onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
          >
            <ZoomOut size={16} strokeWidth={1.8} aria-hidden="true" />
          </Button>
          <span className={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
          <Button
            variant="icon"
            className={styles.zoomButton}
            aria-label="Zoom in"
            disabled={zoomIndex === ZOOM_OPTIONS.length - 1}
            onClick={() => setZoomIndex((index) => Math.min(ZOOM_OPTIONS.length - 1, index + 1))}
          >
            <ZoomIn size={16} strokeWidth={1.8} aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div className={styles.editorArea}>
        <DocumentEditor
          className={styles.editorRoot}
          paged={layout === "paged"}
          pageFormat={pageFormat}
          margins={margins}
          onMarginsChange={setMargins}
          initialMarkdown={SAMPLE_BOOK}
          zoom={zoom}
          onPageCountChange={setPages}
          onWordCountChange={setWords}
          searchQuery={searchQuery}
          searchActiveIndex={searchIndex}
          onSearchResultCount={setSearchCount}
        />
      </div>
    </main>
  );
}
