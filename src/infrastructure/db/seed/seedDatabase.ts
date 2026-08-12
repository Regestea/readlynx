import type Database from "better-sqlite3";

const SEED_BOOK_ID = "seed-book-1";
const SEED_DOCUMENT_ID = "seed-document-1";

/** Minimal valid Lexical editor state (the whole document as JSON). */
const SEED_CONTENT_JSON = JSON.stringify({
  root: {
    children: [
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: "normal",
            style: "",
            text: "The Mountain Keep",
            type: "text",
            version: 1,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "heading",
        version: 1,
        tag: "h1",
      },
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: "normal",
            style: "",
            text: "Seeded from the ReadLynx database. Write your story here, or export this document from the File menu.",
            type: "text",
            version: 1,
          },
        ],
        direction: null,
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
        textFormat: 0,
        textStyle: "",
      },
    ],
    direction: null,
    format: "",
    indent: 0,
    type: "root",
    version: 1,
  },
});

/** Inserts a demo book the first time the database is created. */
export function seedDatabase(db: Database.Database): void {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM Books").get() as {
    count: number;
  };
  if (count > 0) return;

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO Books (id, title, coverImage, createdAt, updatedAt) VALUES (?, ?, NULL, ?, ?)",
    ).run(SEED_BOOK_ID, "The Mountain Keep", now, now);
    db.prepare("INSERT INTO Documents (id, bookId, contentJson) VALUES (?, ?, ?)").run(
      SEED_DOCUMENT_ID,
      SEED_BOOK_ID,
      SEED_CONTENT_JSON,
    );
    db.prepare("INSERT INTO DocumentSettings (documentId) VALUES (?)").run(SEED_DOCUMENT_ID);
  })();
}
