import type { ReactNode } from "react";
import type { Book } from "../../../../shared/types";
import { BookCard } from "../BookCard/BookCard";
import { Card } from "../../../../components/ui/Card/Card";
import styles from "./Shelf.module.css";

interface ShelfProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  books: Book[];
  loading?: boolean;
  onBookClick?: (bookId: string) => void;
  onDeleteBook?: (book: Book) => void;
}

const SKELETON_COUNT = 4;

export function Shelf({
  icon,
  title,
  subtitle,
  books,
  loading = false,
  onBookClick,
  onDeleteBook,
}: ShelfProps) {
  return (
    <Card className={`animate-fade-up ${styles.shelf}`}>
      <div className={styles.head}>
        <div className={styles.titleGroup}>
          <span className={styles.icon} aria-hidden="true">
            {icon}
          </span>
          <div>
            <h2 className={styles.title}>{title}</h2>
            <p className={styles.subtitle}>{subtitle}</p>
          </div>
        </div>
      </div>
      {loading ? (
        <div className={styles.grid} aria-hidden="true">
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <div key={index} className={`${styles.skeletonCard} ${styles.skeletonPulse}`}>
              <div className={styles.skeletonCover} />
              <div className={styles.skeletonLine} />
            </div>
          ))}
        </div>
      ) : books.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true">
            {icon}
          </span>
          <p className={styles.emptyText}>Your shelf is empty.</p>
          <p className={styles.emptyHint}>Create your first book to get started.</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onClick={onBookClick ? () => onBookClick(book.id) : undefined}
              onDelete={onDeleteBook ? () => onDeleteBook(book) : undefined}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
