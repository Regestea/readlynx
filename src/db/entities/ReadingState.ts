/** Row of the `ReadingState` table (one per book). */
export interface ReadingStateEntity {
  bookId: string;
  currentPage: number;
  scrollPosition: number;
  updatedAt: string;
}
