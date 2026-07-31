import { Quote } from "lucide-react";
import type { Quote as QuoteType } from "../../shared/types";
import { Card } from "../ui/Card/Card";
import styles from "./QuoteCard.module.css";

interface QuoteCardProps {
  quote: QuoteType;
}

export function QuoteCard({ quote }: QuoteCardProps) {
  return (
    <Card variant="glass" className={styles.card}>
      <span className={styles.mark} aria-hidden="true">
        <Quote size={20} strokeWidth={1.8} />
      </span>
      <blockquote className={styles.text}>{quote.text}</blockquote>
      <div className={styles.author}>
        <span className={styles.divider} aria-hidden="true" />
        <div>
          <p className={styles.authorName}>{quote.author}</p>
          {quote.source && <p className={styles.authorSource}>{quote.source}</p>}
        </div>
      </div>
    </Card>
  );
}
