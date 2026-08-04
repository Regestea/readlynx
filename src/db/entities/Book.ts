/** Row of the `Books` table. `coverImage` is a relative path like
 *  `covers/<file>` (files live next to the database file). */
export interface BookEntity {
  id: string;
  title: string;
  coverImage: string | null;
  createdAt: string;
  updatedAt: string;
}
