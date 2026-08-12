import { useEffect, useState } from "react";
import { BookOpen, Languages, NotebookPen } from "lucide-react";
import { AddModeCard } from "../widgets/AddModeCard/AddModeCard";
import { Shelf } from "../widgets/Shelf/Shelf";
import { CreateBookDialog } from "./CreateBookDialog";
import type { CreateBookDetails } from "./CreateBookDialog";
import { TranslateBookDialog } from "./TranslateBookDialog";
import { ReadBookDialog } from "./ReadBookDialog";
import { Modal } from "../../../components/ui/Modal/Modal";
import { Button } from "../../../components/ui/Button/Button";
import { coverUrl } from "../../../shared/coverUrl";
import type { Book, CoverStyle } from "../../../shared/types";
import type { BookListItem } from "../../../infrastructure/db/entities/types";
import styles from "./HomePage.module.css";

interface HomePageProps {
  onCreateBook?: (details: CreateBookDetails) => void;
  onOpenBook?: (bookId: string) => void;
  /** Opens a reading-kind book in the read-only reader. */
  onOpenReadingBook?: (bookId: string) => void;
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
    coverImage: coverUrl(row.coverImage),
    kind: row.kind,
  };
}

export function HomePage({ onCreateBook, onOpenBook, onOpenReadingBook }: HomePageProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [translateOpen, setTranslateOpen] = useState(false);
  const [readOpen, setReadOpen] = useState(false);
  const [books, setBooks] = useState<Book[] | null>(null);
  const [bookToDelete, setBookToDelete] = useState<Book | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const handleConfirmDelete = async () => {
    if (!bookToDelete || !window.readlynx) return;
    setDeleting(true);
    try {
      const removed = await window.readlynx.db.deleteBook(bookToDelete.id);
      if (removed) {
        setBooks((prev) => (prev ? prev.filter((book) => book.id !== bookToDelete.id) : prev));
      }
    } finally {
      setDeleting(false);
      setBookToDelete(null);
    }
  };

  const shelfBooks = books ?? [];
  const shelfLoading = books === null;

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
            onClick={() => setTranslateOpen(true)}
          />
          <AddModeCard
            icon={<BookOpen size={22} strokeWidth={1.8} />}
            title="Reading Book"
            description="Add a book to your reading shelf"
            onClick={() => setReadOpen(true)}
          />
        </div>
      </section>

      <Shelf
        icon={<BookOpen size={20} strokeWidth={1.8} />}
        title="Your Shelf"
        subtitle="Everything you're writing, translating, and reading"
        books={shelfBooks}
        loading={shelfLoading}
        onBookClick={(bookId) => {
          const book = books?.find((entry) => entry.id === bookId);
          if (book?.kind === "reading") {
            onOpenReadingBook?.(bookId);
          } else {
            onOpenBook?.(bookId);
          }
        }}
        onDeleteBook={setBookToDelete}
      />

      <CreateBookDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onConfirm={(details) => {
          setDialogOpen(false);
          onCreateBook?.(details);
        }}
      />

      <TranslateBookDialog
        open={translateOpen}
        onClose={() => setTranslateOpen(false)}
        onConfirm={(bookId) => {
          setTranslateOpen(false);
          onOpenBook?.(bookId);
        }}
      />

      <ReadBookDialog
        open={readOpen}
        onClose={() => setReadOpen(false)}
        onConfirm={(bookId) => {
          setReadOpen(false);
          onOpenReadingBook?.(bookId);
        }}
      />

      <Modal
        open={bookToDelete !== null}
        onClose={() => setBookToDelete(null)}
        title="Delete book"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBookToDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleConfirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </>
        }
      >
        <p className={styles.deleteText}>
          Are you sure you want to delete “{bookToDelete?.title}”? Its document and settings will
          be permanently removed. This cannot be undone.
        </p>
      </Modal>
    </main>
  );
}
