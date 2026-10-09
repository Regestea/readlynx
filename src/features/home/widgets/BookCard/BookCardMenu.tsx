import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./BookCardMenu.module.css";

export interface BookCardMenuItem {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  danger?: boolean;
}

interface BookCardMenuProps {
  /** Viewport coordinates of the right-click. */
  at: { x: number; y: number };
  title: string;
  /** Omitted when the card has no primary action to offer. */
  items: BookCardMenuItem[];
  onClose: () => void;
}

/** Gap kept between the menu and the viewport edge, and the margin between it
 *  and the cursor when the pointer position is still inside. */
const EDGE_GAP = 8;
const CURSOR_OFFSET = 2;

/** Right-click actions for a book card.
 *
 *  A menu rather than a fourth hover button: the smallest card in the shelf is
 *  148px wide and the three existing buttons already reach 110px from the
 *  right edge, so a fourth has nowhere to go. The menu costs no layout at all
 *  and still has room for every action.
 *
 *  Portaled to `document.body` for the same reason the title bar's tab list is:
 *  the card sits inside several `backdrop-filter` surfaces, each of which is a
 *  stacking context that would trap the menu under them. */
export function BookCardMenu({ at, title, items, onClose }: BookCardMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({ top: 0, left: 0, visibility: "hidden" });

  /** Flips the menu back inside the viewport once it knows its own size, which
   *  it only can after laying out — hence measuring after paint rather than
   *  from guessed dimensions. */
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const box = menu.getBoundingClientRect();
    const maxLeft = window.innerWidth - box.width - EDGE_GAP;
    const maxTop = window.innerHeight - box.height - EDGE_GAP;
    setPosition({
      top: Math.min(at.y + CURSOR_OFFSET, Math.max(EDGE_GAP, maxTop)),
      left: Math.max(EDGE_GAP, Math.min(at.x + CURSOR_OFFSET, Math.max(EDGE_GAP, maxLeft))),
      visibility: "visible",
    });
  }, [at]);

  useEffect(() => {
    // Focus the first item so the whole menu is reachable from the keyboard,
    // and so Escape lands somewhere sensible.
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    // A scroll or resize moves the card out from under a menu pinned to
    // viewport coordinates, so it is dismissed rather than left floating.
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      role="menu"
      aria-label={`Actions for ${title}`}
      style={position}
      onContextMenu={(event: ReactMouseEvent) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className={`${styles.item} ${item.danger ? styles.itemDanger : ""}`}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          <span className={styles.itemIcon} aria-hidden="true">
            {item.icon}
          </span>
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}