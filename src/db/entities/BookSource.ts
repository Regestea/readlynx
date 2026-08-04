/** Row of the `BookSources` table. */
export interface BookSourceEntity {
  id: string;
  bookId: string;
  sourceType: string;
  filePath: string;
  createdAt: string;
}
