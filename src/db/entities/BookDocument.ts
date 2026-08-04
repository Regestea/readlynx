/** Row of the `Documents` table (one per book). */
export interface BookDocumentEntity {
  id: string;
  bookId: string;
  /** The whole Lexical document, serialized as JSON. */
  contentJson: string;
}
