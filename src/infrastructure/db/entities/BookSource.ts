/** Row of the `BookSources` table. `fileHash` / `fileSize` identify the
 *  imported content (sha256 + byte length — `NULL` for books added before
 *  identity tracking) and `originalPath` remembers where the file was
 *  picked from. */
export interface BookSourceEntity {
  id: string;
  bookId: string;
  sourceType: string;
  filePath: string;
  fileHash: string | null;
  fileSize: number | null;
  originalPath: string | null;
  createdAt: string;
}
