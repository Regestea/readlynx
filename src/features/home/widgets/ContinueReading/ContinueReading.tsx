import { ArrowRight } from "lucide-react";
import { BookCard } from "../../../../components/BookCard/BookCard";
import { Button } from "../../../../components/ui/Button/Button";
import { Card } from "../../../../components/ui/Card/Card";
import { continueReadingBooks } from "../../data/mockData";
import styles from "./ContinueReading.module.css";

export function ContinueReading() {
  return (
    <Card className={`animate-fade-up ${styles.widget}`}>
      <div className={styles.head}>
        <div>
          <h2 className={styles.title}>Continue Reading</h2>
          <p className={styles.subtitle}>Pick up where you left off</p>
        </div>
        <Button variant="ghost">
          View all
          <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
        </Button>
      </div>
      <div className={styles.row}>
        {continueReadingBooks.map((book) => (
          <BookCard key={book.id} book={book} layout="horizontal" />
        ))}
      </div>
    </Card>
  );
}
