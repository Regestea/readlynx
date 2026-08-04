import type { ReactNode } from "react";
import type { Book } from "../../../../shared/types";
import { BookCard } from "../../../../components/BookCard/BookCard";
import { Card } from "../../../../components/ui/Card/Card";
import styles from "./Shelf.module.css";

interface ShelfProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  books: Book[];
  onBookClick?: (bookId: string) => void;
}

export function Shelf({ icon, title, subtitle, books, onBookClick }: ShelfProps) {
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
      <div className={styles.grid}>
        {books.map((book) => (
          <BookCard
            key={book.id}
            book={book}
            onClick={onBookClick ? () => onBookClick(book.id) : undefined}
          />
        ))}
      </div>
    </Card>
  );
}
