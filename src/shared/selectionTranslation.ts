/** Where the selection-translation circle sends the selected text.
 *
 *  - `ai`: the saved model chosen in Settings (or the app default model).
 *  - `google`: Google's public Translate web endpoint (no API key).
 *
 *  Stored app-wide in `AppSettings` and chosen in Settings. */
export type SelectionTranslationProvider = "ai" | "google";

/** Translation returned for a text selection, plus the provider that produced
 *  it (so the popover can label the result honestly). */
export interface SelectionTranslationResult {
  text: string;
  provider: SelectionTranslationProvider;
}
