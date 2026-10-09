import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Check, ChevronDown, Copy, Minus, Square, X } from "lucide-react";
import type { Tab } from "../../tabs";
import { isClosableTab } from "../../tabs";
import styles from "./TitleBar.module.css";

/** How far the last tab has to stick out past the strip, in px, before the
 *  chevron appears. Just over a pixel: any clipping at all must raise it,
 *  because a tab sliced even slightly can no longer be clicked or closed —
 *  its close button is the part that gets cut. This does not oscillate.
 *  Showing the chevron takes its width *out* of the strip, so the overhang
 *  only ever grows, and hiding it hands that width back, so the overhang only
 *  ever shrinks — both directions settle on the first frame. */
const OVERFLOW_SLACK = 1;

/** One tab's icon, matching the page behind it. */
function TabIcon({ kind }: { kind: Tab["kind"] }) {
  const size = 13;
  const strokeWidth = 1.8;
  if (kind === "home") {
    return <BookOpen size={size} strokeWidth={strokeWidth} aria-hidden="true" />;
  }
  // Books are identified by their label. A cover thumbnail per tab would cost
  // a file read and a decode for every open book.
  return null;
}

interface TitleBarProps {
  /** Empty in a reader window, which has one book and no tab bar. */
  tabs: Tab[];
  activeId: string;
  /** Optional because a reader window has no tabs to act on. */
  onActivate?: (id: string) => void;
  onClose?: (id: string) => void;
  onMove?: (id: string, toIndex: number) => void;
  /** A tab dragged off the strip opens in its own window. */
  onDetach?: (tab: Tab) => void;
  /** Shown in place of the strip when there are no tabs. */
  label?: string;
}

/** Replaces the OS caption (`titleBarStyle: "hidden"`), so the window can be
 *  dragged, maximized, minimized and closed from the app's own chrome, and
 *  carries the open views.
 *
 *  The window buttons drive the real window over IPC rather than faking it: the
 *  maximize glyph has to follow changes the user did not ask for (taskbar
 *  double-click, Win+Up, snap layouts, a restored size), which arrive through
 *  `onMaximizedChanged`. */
export function TitleBar({
  tabs,
  activeId,
  onActivate,
  onClose,
  onMove,
  onDetach,
  label,
}: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState<Tab | null>(null);
  const [detachArmed, setDetachArmed] = useState(false);
  /** Viewport coordinates of the chevron, so the portaled panel can be pinned
   *  to it — the panel lives on `document.body`, outside the bar. */
  const [panelAnchor, setPanelAnchor] = useState<CSSProperties | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  /** The chevron appears the moment the tabs stop fitting — not at a fixed tab
   *  count, which would show it on a wide window with plenty of room left, and
   *  not a moment later than the first clipped pixel, since a tab cut even
   *  slightly can no longer be clicked or closed.
   *
   *  Measured by how far the last tab's right edge sits past the strip's, not
   *  by `scrollWidth`: that only answered after a window resize, because the
   *  row's overflow width is not something the flex container reliably reports
   *  for items clipped by its own `overflow: hidden`. Re-measured whenever the
   *  tabs change in any way (opened, closed, renamed, reordered) and whenever
   *  the strip is resized. Deferred to a frame so the strip is laid out first,
   *  and so the read is not a cascading synchronous render. */
  useEffect(() => {
    let frame = 0;
    const strip = stripRef.current;
    const measure = () => {
      const last = strip?.lastElementChild;
      if (!strip || !(last instanceof HTMLElement)) return;
      const overhang = last.getBoundingClientRect().right - strip.getBoundingClientRect().right;
      setClipped(overhang > OVERFLOW_SLACK);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    if (strip) observer.observe(strip);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [tabs]);

  const visibleTabs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tabs;
    return tabs.filter((tab) => tab.title.toLowerCase().includes(needle));
  }, [query, tabs]);

  const closeOverflow = useCallback(() => {
    setOverflowOpen(false);
    setPanelAnchor(null);
    setQuery("");
  }, []);

  /** Measures the chevron so the portaled panel can sit under it, right edge to
   *  right edge. Re-measured while the panel is open so a window resize drags
   *  the panel along instead of leaving it pinned to a stale spot. */
  const measureAnchor = useCallback(() => {
    const box = overflowRef.current?.getBoundingClientRect();
    if (!box) return;
    setPanelAnchor({
      top: box.bottom + 6,
      right: Math.max(0, window.innerWidth - box.right),
    });
  }, []);

  /** Activating from the dropdown dismisses it — otherwise it stays open over
   *  the page that was just brought forward. */
  const pickFromOverflow = useCallback(
    (id: string) => {
      onActivate?.(id);
      closeOverflow();
    },
    [closeOverflow, onActivate],
  );

  useEffect(() => {
    if (!overflowOpen || !clipped) return;
    searchRef.current?.focus();
    measureAnchor();
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      // Both halves count as "inside": the panel is portaled, so a click on it
      // is not contained by the chevron, and treating that as an outside click
      // would unmount the item before its own click ever fired.
      if (overflowRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      closeOverflow();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeOverflow();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", measureAnchor);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", measureAnchor);
    };
  }, [overflowOpen, clipped, closeOverflow, measureAnchor]);

  useEffect(() => {
    const controls = window.readlynx?.windowControls;
    if (!controls) return;
    void controls.isMaximized().then(setMaximized);
    return controls.onMaximizedChanged(setMaximized);
  }, []);

  /** With no OS caption there is no double-click-to-maximize, so the gesture
   *  the drag region used to provide is re-implemented here. */
  const handleBarDoubleClick = () => {
    void window.readlynx?.windowControls?.toggleMaximize();
  };

  /** Dragging a tab off the strip opens it in its own window, the way every
   *  other tabbed app does it.
   *
   *  The strip only accepts drops that land *on* one of its tabs, so a drop
   *  anywhere else — over the page, the sidebar, outside the window — never
   *  reaches it and the drag would just be cancelled. Those drops are picked
   *  up by window-level listeners for the duration of the drag, using the
   *  same bounds test so a drop inside the strip still reorders and only the
   *  rest detaches. `copy` rather than `move` for the cursor, since nothing is
   *  being removed from this window. */
  useEffect(() => {
    if (!dragging || !onDetach) return;
    const outsideStrip = (event: globalThis.DragEvent) => {
      const strip = stripRef.current;
      if (!strip) return true;
      const box = strip.getBoundingClientRect();
      return (
        event.clientY < box.top ||
        event.clientY > box.bottom ||
        event.clientX < box.left ||
        event.clientX > box.right
      );
    };
    const onDragOver = (event: globalThis.DragEvent) => {
      if (!outsideStrip(event)) return;
      // Accepting the drag is what makes the drop fire at all.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setDetachArmed(true);
    };
    const onDrop = (event: globalThis.DragEvent) => {
      if (!outsideStrip(event)) return;
      event.preventDefault();
      setDetachArmed(false);
      setDragging(null);
      onDetach(dragging);
    };
    // `dragend` fires on the source element for a cancelled drag (Escape, or
    // a drop the browser refused) — the only way to clear the armed state.
    const clear = () => {
      setDetachArmed(false);
      setDragging(null);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", clear);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", clear);
    };
  }, [dragging, onDetach]);

  const handleDragStart = (event: DragEvent<HTMLDivElement>, tab: Tab) => {
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("text/plain", tab.id);
    setDragging(tab);
  };

  /** Drops are only accepted once this handler cancels the event, otherwise the
   *  browser treats them as a no-op and the tab snaps back where it started. */
  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, index: number) => {
    event.preventDefault();
    setDetachArmed(false);
    setDragging(null);
    const id = event.dataTransfer.getData("text/plain");
    if (!id) return;
    // Dropping on a tab's leading half puts the dragged tab before it, the
    // trailing half after it — measured on the tab's own box so the strip can
    // scroll and the bar can sit anywhere in the window.
    const { left, width } = event.currentTarget.getBoundingClientRect();
    onMove?.(id, event.clientX < left + width / 2 ? index : index + 1);
  };

  const handleTabClick = (event: ReactMouseEvent<HTMLDivElement>, tab: Tab) => {
    // A middle click is the second way to close a tab, as in every other
    // tabbed app. Stopping here keeps it from also activating the tab, and it
    // is offered only on the tabs that can be closed at all.
    if (event.button === 1) {
      event.preventDefault();
      if (isClosableTab(tab)) onClose?.(tab.id);
      return;
    }
    if (event.button === 0) onActivate?.(tab.id);
  };

  return (
    // The armed class is the drop-target hint: once the pointer is outside the
    // strip, the whole bar says so rather than the cursor changing alone.
    <div
      className={`${styles.bar} ${detachArmed ? styles.barDetach : ""}`}
      onDoubleClick={handleBarDoubleClick}
    >
      {/* A reader window has one book and no tabs: the strip renders empty and
          takes the space, and the book's name sits at the start of the row. */}
      {tabs.length === 0 && (
        <span className={styles.barLabel} title={label}>
          {label}
        </span>
      )}
      <div className={`${styles.tabs} ${clipped ? styles.tabsClipped : ""}`} ref={stripRef}>
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
              aria-current={isActive ? "page" : undefined}
              title={tab.title}
              draggable
              onClick={(event) => handleTabClick(event, tab)}
              onDragStart={(event) => handleDragStart(event, tab)}
              onDragOver={handleDragOver}
              onDrop={(event) => handleDrop(event, index)}
            >
              <span className={styles.tabIcon}>
                <TabIcon kind={tab.kind} />
              </span>
              <span className={styles.tabTitle}>{tab.title}</span>
              {isClosableTab(tab) && (
                <button
                  type="button"
                  className={styles.tabClose}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose?.(tab.id);
                  }}
                  aria-label={`Close ${tab.title}`}
                  title={`Close ${tab.title}`}
                >
                  <X size={12} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Outside the strip, not inside it: the strip clips, so a chevron
          sharing that box would be pushed past the edge and clipped away
          exactly when it is needed. Click to open — hover made it flicker
          shut the moment the pointer crossed the gap on its way to the list. */}
      {clipped && (
        <div className={styles.overflow} ref={overflowRef}>
          <button
            type="button"
            className={`${styles.overflowButton} ${overflowOpen ? styles.overflowButtonOpen : ""}`}
            onClick={() => {
              measureAnchor();
              setOverflowOpen((open) => !open);
            }}
            aria-label="All open views"
            aria-expanded={overflowOpen}
            aria-haspopup="true"
            title="All open views"
          >
            <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>

          {overflowOpen &&
            createPortal(
              <div
                ref={panelRef}
                className={styles.overflowPanel}
                style={panelAnchor ?? undefined}
              >
                <input
                  ref={searchRef}
                  className={styles.overflowSearch}
                  type="text"
                  value={query}
                  placeholder="Search open views…"
                  aria-label="Search open views"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    const first = visibleTabs[0];
                    if (first) pickFromOverflow(first.id);
                  }}
                />
                {visibleTabs.length === 0 ? (
                  <p className={styles.overflowEmpty}>No view matches “{query.trim()}”.</p>
                ) : (
                  <ul className={styles.overflowList} aria-label="Open views">
                    {visibleTabs.map((tab) => (
                      <li key={tab.id} className={styles.overflowRow}>
                        <button
                          type="button"
                          className={`${styles.overflowItem} ${tab.id === activeId ? styles.overflowItemCurrent : ""}`}
                          aria-current={tab.id === activeId ? "page" : undefined}
                          onClick={() => pickFromOverflow(tab.id)}
                        >
                          <span className={styles.tabIcon}>
                            <TabIcon kind={tab.kind} />
                          </span>
                          <span className={styles.overflowItemTitle}>{tab.title}</span>
                          {tab.id === activeId && (
                            <Check size={14} strokeWidth={2} aria-hidden="true" />
                          )}
                        </button>
                        {/* The whole reason the list is searchable: a tab
                            clipped past the window edge has its own close
                            button cut off, so this is the only way to
                            dismiss it. A sibling, not a child — a button
                            inside a button is invalid and its clicks would
                            activate the tab as well. */}
                        {isClosableTab(tab) && (
                          <button
                            type="button"
                            className={styles.overflowItemClose}
                            onClick={() => {
                              onClose?.(tab.id);
                              closeOverflow();
                            }}
                            aria-label={`Close ${tab.title}`}
                            title={`Close ${tab.title}`}
                          >
                            <X size={12} strokeWidth={2} aria-hidden="true" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>,
              document.body,
            )}
        </div>
      )}

      {/* `margin-inline-start: auto` keeps the controls on the trailing edge
          in either writing direction. */}
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.button}
          onClick={() => void window.readlynx?.windowControls?.minimize()}
          aria-label="Minimize"
          title="Minimize"
        >
          <Minus size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => void window.readlynx?.windowControls?.toggleMaximize()}
          aria-label={maximized ? "Restore" : "Maximize"}
          title={maximized ? "Restore" : "Maximize"}
        >
          {maximized ? (
            <Copy size={13} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <Square size={13} strokeWidth={1.8} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonClose}`}
          onClick={() => void window.readlynx?.windowControls?.close()}
          aria-label="Close window"
          title="Close window"
        >
          <X size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
