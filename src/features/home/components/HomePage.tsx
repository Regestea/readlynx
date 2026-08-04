import { useEffect, useState } from "react";
import { BookOpen, Languages, NotebookPen } from "lucide-react";
import { AddModeCard } from "../widgets/AddModeCard/AddModeCard";
import { Shelf } from "../widgets/Shelf/Shelf";
import { CreateBookDialog } from "../../create/components/CreateBookDialog";
import type { CreateBookDetails } from "../../create/components/CreateBookDialog";
import { Modal } from "../../../components/ui/Modal/Modal";
import { Button } from "../../../components/ui/Button/Button";
import { coverUrl } from "../../../shared/coverUrl";
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
    coverImage: coverUrl(row.coverImage),
    kind: "created",
  };
}

export function HomePage({ onCreateBook, onOpenBook }: HomePageProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
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
        loading={shelfLoading}
        onBookClick={onOpenBook}
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
