import { QuoteCard } from "../../../../components/QuoteCard/QuoteCard";
import { dailyQuote } from "../../data/mockData";
import styles from "./Quote.module.css";

export function Quote() {
  return (
    <div className={`animate-fade-up ${styles.widget}`}>
      <QuoteCard quote={dailyQuote} />
    </div>
  );
}
