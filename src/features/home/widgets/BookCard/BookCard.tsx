import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { BookOpen, ExternalLink, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import type { Book, BookKind } from "../../../../shared/types";
import { Progress } from "../../../../components/ui/Progress/Progress";
import { BookCardMenu } from "./BookCardMenu";
import type { BookCardMenuItem } from "./BookCardMenu";
import styles from "./BookCard.module.css";

interface BookCardProps {
  book: Book;
  layout?: "vertical" | "horizontal";
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
  onTogglePin?: () => void;
  /** Opens the book in its own window. Offered by the right-click menu only,
   *  and only for reading books — a reader window shows a book, which is not
   *  the editor view a created or translated book wants. */
  onOpenInWindow?: () => void;
}

const COVER_STYLES: Record<Book["cover"], string> = {
  forest: styles.coverForest,
  moss: styles.coverMoss,
  terracotta: styles.coverTerracotta,
  navy: styles.coverNavy,
  sand: styles.coverSand,
  moon: styles.coverMoon,
};

const BADGE_LABELS: Record<BookKind, string> = {
  created: "Created",
  translated: "Translated",
  reading: "Reading",
};

function handleCardKeyDown(event: KeyboardEvent, onClick?: () => void) {
  if (!onClick) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onClick();
  }
}

function handleActionKeyDown(event: KeyboardEvent, onAction: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    event.stopPropagation();
    onAction();
  }
}

/** Titles longer than this get a hover tooltip with the full name (shorter
 *  titles always fit, so no tooltip is needed for them). Roughly matches the
 *  visible width of a two-line truncated shelf title. */
const TITLE_TOOLTIP_THRESHOLD = 40;

/** Full-title tooltip props for a truncated title — absent for short titles
 *  that always fit. The visible text keeps the complete title, so screen
 *  readers are unaffected and the tooltip is purely visual. */
function fullTitleProps(title: string): { "data-full-title"?: string } {
  return title.length > TITLE_TOOLTIP_THRESHOLD ? { "data-full-title": title } : {};
}

export function BookCard({
  book,
  layout = "vertical",
  className = "",
  style,
  onClick,
  onDelete,
  onEdit,
  onTogglePin,
  onOpenInWindow,
}: BookCardProps) {
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenuAt(null), []);

  const interactiveProps = onClick
    ? {
        role: "button",
        tabIndex: 0,
        onClick,
        onKeyDown: (event: KeyboardEvent) => handleCardKeyDown(event, onClick),
      }
    : {};
  const clickClass = onClick ? ` ${styles.clickable}` : "";

  // Only offered where it means something: a reader window holds one book, so
  // it is a view for reading books, not for the editor behind them.
  const canOpenInWindow = Boolean(onOpenInWindow) && book.kind === "reading";
  const canMenu = Boolean(onClick || onOpenInWindow || onEdit || onTogglePin || onDelete);

  /** Right-click opens the action menu. The browser menu is suppressed only
   *  when the card actually has something to offer, so a card with no actions
   *  still gets the native menu. */
  const handleContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    if (!canMenu) return;
    event.preventDefault();
    setMenuAt({ x: event.clientX, y: event.clientY });
  };

  /** Escape closes the menu; the card keeps its own click behaviour. */
  useEffect(() => {
    if (!menuAt) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuAt, closeMenu]);

  const deleteButton = onDelete ? (
    <button
      type="button"
      className={styles.deleteButton}
      onClick={(event) => {
        event.stopPropagation();
        onDelete();
      }}
      onKeyDown={(event) => handleActionKeyDown(event, onDelete)}
      aria-label={`Delete ${book.title}`}
      title="Delete book"
    >
      <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
    </button>
  ) : null;

  const editButton = onEdit ? (
    <button
      type="button"
      className={styles.editButton}
      onClick={(event) => {
        event.stopPropagation();
        onEdit();
      }}
      onKeyDown={(event) => handleActionKeyDown(event, onEdit)}
      aria-label={`Edit ${book.title}`}
      title="Edit book"
    >
      <Pencil size={14} strokeWidth={1.8} aria-hidden="true" />
    </button>
  ) : null;

  const pinned = book.isPinned === true;
  const pinButton = onTogglePin ? (
    <button
      type="button"
      className={`${styles.pinButton} ${pinned ? styles.pinActive : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        onTogglePin();
      }}
      onKeyDown={(event) => handleActionKeyDown(event, onTogglePin)}
      aria-label={pinned ? `Unpin ${book.title}` : `Pin ${book.title}`}
      aria-pressed={pinned}
      title={pinned ? "Unpin book" : "Pin book"}
    >
      {pinned ? (
        <PinOff size={14} strokeWidth={1.8} aria-hidden="true" />
      ) : (
        <Pin size={14} strokeWidth={1.8} aria-hidden="true" />
      )}
    </button>
  ) : null;

  /** Everything the right-click menu can offer, in the order it is shown.
   *  "Open in new window" sits directly under "Open" because the two are
   *  alternatives to each other. */
  const menuItems: BookCardMenuItem[] = [];
  if (onClick) {
    menuItems.push({
      key: "open",
      label: "Open",
      icon: <BookOpen size={14} strokeWidth={1.8} aria-hidden="true" />,
      onSelect: onClick,
    });
  }
  if (canOpenInWindow && onOpenInWindow) {
    menuItems.push({
      key: "open-window",
      label: "Open in new window",
      icon: <ExternalLink size={14} strokeWidth={1.8} aria-hidden="true" />,
      onSelect: onOpenInWindow,
    });
  }
  if (onTogglePin) {
    menuItems.push({
      key: "pin",
      label: pinned ? "Unpin" : "Pin",
      icon: pinned ? (
        <PinOff size={14} strokeWidth={1.8} aria-hidden="true" />
      ) : (
        <Pin size={14} strokeWidth={1.8} aria-hidden="true" />
      ),
      onSelect: onTogglePin,
    });
  }
  if (onEdit) {
    menuItems.push({
      key: "edit",
      label: "Edit",
      icon: <Pencil size={14} strokeWidth={1.8} aria-hidden="true" />,
      onSelect: onEdit,
    });
  }
  if (onDelete) {
    menuItems.push({
      key: "delete",
      label: "Delete",
      icon: <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />,
      onSelect: onDelete,
      danger: true,
    });
  }

  const menu =
    menuAt && menuItems.length > 0 ? (
      <BookCardMenu at={menuAt} title={book.title} items={menuItems} onClose={closeMenu} />
    ) : null;

  if (layout === "horizontal") {
    return (
      <>
        <article
          className={`${styles.horizontal} hover-lift ${className}${clickClass}`}
          style={style}
          aria-label={`${book.title} by ${book.author}`}
          onContextMenu={handleContextMenu}
          {...interactiveProps}
        >
        <div
          className={`${styles.cover} ${styles.coverSmall} ${COVER_STYLES[book.cover]}`}
          aria-hidden="true"
        >
{book.coverImage && (
            <img
              className={styles.coverImage}
              src={book.coverImage}
              alt=""
              loading="lazy"
              decoding="async"
            />
          )}
        </div>
        <div className={styles.hInfo} {...fullTitleProps(book.title)}>
          <h3 className={styles.hTitle}>{book.title}</h3>
          <p className={styles.hAuthor}>{book.author}</p>
          {typeof book.progress === "number" && (
            <div className={styles.hProgress}>
              <Progress value={book.progress} thickness={6} />
              <span className={styles.hPercent}>{Math.round(book.progress * 100)}%</span>
            </div>
          )}
        </div>
      </article>
      {menu}
    </>
    );
  }

  return (
    <>
      <article
        className={`${styles.vertical} ${className}${clickClass}`}
        style={style}
        aria-label={`${book.title} by ${book.author}`}
        onContextMenu={handleContextMenu}
        {...interactiveProps}
      >
      <div className={`${styles.cover} ${COVER_STYLES[book.cover]}`} aria-hidden="true">
        {book.coverImage && (
          <img
            className={styles.coverImage}
            src={book.coverImage}
            alt=""
            loading="lazy"
            decoding="async"
          />
        )}
        {book.kind && <span className={styles.badge}>{BADGE_LABELS[book.kind]}</span>}
        {pinned && (
          <span className={styles.pinnedBadge} aria-hidden="true">
            <Pin size={10} strokeWidth={2.5} aria-hidden="true" />
          </span>
        )}
      </div>
      {pinButton}
      {editButton}
      {deleteButton}
      <div className={styles.meta} {...fullTitleProps(book.title)}>
          <h3 className={styles.metaTitle}>{book.title}</h3>
          <p className={styles.metaAuthor}>{book.author}</p>
        </div>
      </article>
      {menu}
    </>
  );
}
