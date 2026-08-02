import { useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

/**
 * Keeps the caret vertically centered in the scroll container while the user
 * is typing.
 *
 * Lexical's built-in scroll-into-view only brings the caret to the nearest
 * edge of the viewport, which reads as a jarring "jump to a bad position",
 * especially in paged mode where blocks reflow across page boundaries.
 * This plugin instead listens for real user `input` events and re-centers the
 * caret after the DOM settles.
 *
 * The measurement compensates for the page `zoom` transform: the scroll
 * container moves in unscaled layout pixels while the caret rect is reported
 * in scaled visual pixels, so the required scroll delta is `visualDelta / zoom`.
 */
export function CaretScrollPlugin() {
  const [editor] = useLexicalComposerContext();
  const rafRef = useRef(0);

  useEffect(() => {
    const centerCaret = () => {
      const rootEl = editor.getRootElement();
      if (!rootEl) return;

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!range.collapsed) return;
      const caretRect = range.getBoundingClientRect();
      if (caretRect.width === 0 && caretRect.height === 0) return;

      let scroller: HTMLElement | null = rootEl.parentElement;
      while (scroller && scroller !== document.body) {
        const style = getComputedStyle(scroller);
        if (style.overflowY === "auto" || style.overflowY === "scroll") break;
        scroller = scroller.parentElement;
      }
      if (!scroller || scroller === document.body) return;

      /* Detect the visual scale applied to the paged content (zoom transform). */
      let zoom = 1;
      let pageEl: HTMLElement | null = rootEl.parentElement;
      while (pageEl && pageEl !== document.body) {
        const transform = getComputedStyle(pageEl).transform;
        if (transform && transform !== "none") {
          const visualHeight = pageEl.getBoundingClientRect().height;
          const layoutHeight = pageEl.offsetHeight;
          if (layoutHeight > 0 && visualHeight > 0) {
            zoom = visualHeight / layoutHeight;
          }
          break;
        }
        pageEl = pageEl.parentElement;
      }

      const scrollerRect = scroller.getBoundingClientRect();
      const caretCenter = caretRect.top + caretRect.height / 2;
      const scrollerCenter = scrollerRect.top + scrollerRect.height / 2;
      const deltaVisual = caretCenter - scrollerCenter;
      const target = scroller.scrollTop + deltaVisual / zoom;
      const max = scroller.scrollHeight - scroller.clientHeight;
      scroller.scrollTop = Math.max(0, Math.min(target, max));
    };

    /* Double rAF so we run after the pagination pass has settled the layout. */
    const scheduleCentering = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(centerCaret);
      });
    };

    const unregisterRoot = editor.registerRootListener((rootEl, prevRootEl) => {
      prevRootEl?.removeEventListener("input", scheduleCentering);
      rootEl?.addEventListener("input", scheduleCentering);
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      unregisterRoot();
    };
  }, [editor]);

  return null;
}
