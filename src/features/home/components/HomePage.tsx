import { ContinueReading } from "../widgets/ContinueReading/ContinueReading";
import { RecommendedBooks } from "../widgets/RecommendedBooks/RecommendedBooks";
import styles from "./HomePage.module.css";

export function HomePage() {
  return (
    <main className={styles.page} aria-label="Home">
      <ContinueReading />
      <RecommendedBooks />
    </main>
  );
}
