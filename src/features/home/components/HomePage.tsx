import { BookOpen, Languages, NotebookPen } from "lucide-react";
import { AddModeCard } from "../widgets/AddModeCard/AddModeCard";
import { Shelf } from "../widgets/Shelf/Shelf";
import { shelfBooks } from "../data/mockData";
import styles from "./HomePage.module.css";

interface HomePageProps {
  onCreateBook?: () => void;
}

export function HomePage({ onCreateBook }: HomePageProps) {
  return (
    <main className={styles.page} aria-label="Home">
      <div className={`${styles.intro} animate-fade-up`}>
        <h1 className={styles.title}>Your Books</h1>
        <p className={styles.subtitle}>Create, translate, and read — all in one place.</p>
      </div>

      <section className={styles.modes} aria-label="Start something new">
        <h2 className={styles.modesTitle}>Start something new</h2>
        <div className={styles.modesGrid}>
          <AddModeCard
            icon={<NotebookPen size={22} strokeWidth={1.8} />}
            title="Create Book"
            description="Start writing a new book"
            onClick={onCreateBook}
          />
          <AddModeCard
            icon={<Languages size={22} strokeWidth={1.8} />}
            title="Translate Book"
            description="Translate a book to another language"
          />
          <AddModeCard
            icon={<BookOpen size={22} strokeWidth={1.8} />}
            title="Reading Book"
            description="Add a book to your reading shelf"
          />
        </div>
      </section>

      <Shelf
        icon={<BookOpen size={20} strokeWidth={1.8} />}
        title="Your Shelf"
        subtitle="Everything you're writing, translating, and reading"
        books={shelfBooks}
      />
    </main>
  );
}
