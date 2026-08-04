/** Row of the `Books` table. */
export interface BookEntity {
  id: string;
  title: string;
  coverImage: Uint8Array | null;
  createdAt: string;
  updatedAt: string;
}
