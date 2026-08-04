import type { CSSProperties } from "react";
import type { Book, BookKind } from "../../shared/types";
import { Progress } from "../ui/Progress/Progress";
import styles from "./BookCard.module.css";

interface BookCardProps {
  book: Book;
  layout?: "vertical" | "horizontal";
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
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

function handleCardKeyDown(event: React.KeyboardEvent, onClick?: () => void) {
  if (!onClick) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onClick();
  }
}

export function BookCard({
  book,
  layout = "vertical",
  className = "",
  style,
  onClick,
}: BookCardProps) {
  const interactiveProps = onClick
    ? {
        role: "button",
        tabIndex: 0,
        onClick,
        onKeyDown: (event: React.KeyboardEvent) => handleCardKeyDown(event, onClick),
      }
    : {};
  const clickClass = onClick ? ` ${styles.clickable}` : "";

  if (layout === "horizontal") {
    return (
      <article
        className={`${styles.horizontal} hover-lift ${className}${clickClass}`}
        style={style}
        aria-label={`${book.title} by ${book.author}`}
        {...interactiveProps}
      >
        <div
          className={`${styles.cover} ${styles.coverSmall} ${COVER_STYLES[book.cover]}`}
          aria-hidden="true"
        >
          {book.coverImage && <img className={styles.coverImage} src={book.coverImage} alt="" />}
          <span className={styles.coverTitle}>{book.title}</span>
          <span className={styles.coverAuthor}>{book.author}</span>
        </div>
        <div className={styles.hInfo}>
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
    );
  }

  return (
    <article
      className={`${styles.vertical} ${className}${clickClass}`}
      style={style}
      aria-label={`${book.title} by ${book.author}`}
      {...interactiveProps}
    >
      <div className={`${styles.cover} ${COVER_STYLES[book.cover]}`} aria-hidden="true">
        {book.coverImage && <img className={styles.coverImage} src={book.coverImage} alt="" />}
        {book.kind && <span className={styles.badge}>{BADGE_LABELS[book.kind]}</span>}
        <span className={styles.coverTitle}>{book.title}</span>
        <span className={styles.coverAuthor}>{book.author}</span>
      </div>
      <div className={styles.meta}>
        <h3 className={styles.metaTitle}>{book.title}</h3>
        <p className={styles.metaAuthor}>{book.author}</p>
      </div>
    </article>
  );
}
