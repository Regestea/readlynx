import { useEffect, useState } from "react";
import { BookOpen, Languages, NotebookPen } from "lucide-react";
import { AddModeCard } from "../widgets/AddModeCard/AddModeCard";
import { Shelf } from "../widgets/Shelf/Shelf";
import { CreateBookDialog } from "../../create/components/CreateBookDialog";
import type { CreateBookDetails } from "../../create/components/CreateBookDialog";
import { shelfBooks as mockShelfBooks } from "../data/mockData";
import type { Book, CoverStyle } from "../../../shared/types";
import type { BookListItem } from "../../../db/entities/types";
import styles from "./HomePage.module.css";

interface HomePageProps {
  onCreateBook?: (details: CreateBookDetails) => void;
  onOpenBook?: (bookId: string) => void;
}

const COVER_STYLES: CoverStyle[] = ["forest", "moss", "terracotta", "navy", "sand", "moon"];

function coverForId(id: string): CoverStyle {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash + id.charCodeAt(i)) % COVER_STYLES.length;
  }
  return COVER_STYLES[hash];
}

function toBook(row: BookListItem): Book {
  return {
    id: row.id,
    title: row.title,
    author: "",
    cover: coverForId(row.id),
    coverImage: row.coverImage,
    kind: "created",
  };
}

export function HomePage({ onCreateBook, onOpenBook }: HomePageProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [books, setBooks] = useState<Book[] | null>(null);

  useEffect(() => {
    const db = window.readlynx?.db;
    if (!db) return;
    let cancelled = false;
    void db.listBooks().then((rows) => {
      if (cancelled) return;
      setBooks(rows.map(toBook));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const shelfBooks = books ?? mockShelfBooks;

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
            onClick={() => setDialogOpen(true)}
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
        onBookClick={onOpenBook}
      />

      <CreateBookDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onConfirm={(details) => {
          setDialogOpen(false);
          onCreateBook?.(details);
        }}
      />
    </main>
  );
}
