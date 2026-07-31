import { Plus } from "lucide-react";
import { BookCard } from "../../../../components/BookCard/BookCard";
import { Card } from "../../../../components/ui/Card/Card";
import { recommendedBooks } from "../../data/mockData";
import styles from "./RecommendedBooks.module.css";

export function RecommendedBooks() {
  return (
    <Card className={`animate-fade-up ${styles.widget}`}>
      <div className={styles.head}>
        <div>
          <h2 className={styles.title}>Recommended for You</h2>
          <p className={styles.subtitle}>Based on your reading taste</p>
        </div>
      </div>
      <div className={styles.grid}>
        {recommendedBooks.map((book, index) => (
          <BookCard
            key={book.id}
            book={book}
            className="animate-card-appear"
            style={{ animationDelay: `${120 + index * 70}ms` }}
          />
        ))}
        <button
          type="button"
          className={`${styles.addBook} animate-card-appear`}
          style={{ animationDelay: `${120 + recommendedBooks.length * 70}ms` }}
          aria-label="Add a new book"
        >
          <span className={styles.addIcon} aria-hidden="true">
            <Plus size={22} strokeWidth={1.8} />
          </span>
          <span className={styles.addTitle}>Add Book</span>
          <span className={styles.addMeta}>Import your next read</span>
        </button>
      </div>
    </Card>
  );
}
