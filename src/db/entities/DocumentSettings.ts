export type LayoutMode = "paged" | "continuous";

/** Keep in sync with `DocumentEditor/constants.ts` `PageFormat`. */
export type PageFormat =
  | "a4"
  | "a5"
  | "a3"
  | "b5"
  | "letter"
  | "legal"
  | "tabloid"
  | "executive";

/** Row of the `DocumentSettings` table (one per document). */
export interface DocumentSettingsEntity {
  documentId: string;
  layout: LayoutMode;
  pageFormat: PageFormat;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  zoomIndex: number;
  fontFamily: string;
  fontSize: number;
  updatedAt: string;
}
