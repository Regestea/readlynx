/** Row of the `AppSettings` table. */
export interface AppSettingsEntity {
  theme: string;
  /** AI chat conversation zoom in percent (70–160). */
  chatZoom: number;
  /** Whether a PDF opened from the file explorer joins the library (false =
   *  opens as a temporary session file, removed when the app closes). */
  openWithAddPdf: boolean;
  /** Same switch for EPUB files. */
  openWithAddEpub: boolean;
  /** Same switch for Markdown files. */
  openWithAddMarkdown: boolean;
}
