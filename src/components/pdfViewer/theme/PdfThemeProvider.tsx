import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { PdfThemeState } from "./PdfThemeManager";
import {
  loadPdfTheme,
  PDF_THEME_DEFAULT_BACKGROUND,
  savePdfTheme,
} from "./PdfThemeManager";
import { PdfThemeContext } from "./PdfThemeContext";

interface PdfThemeProviderProps {
  children: ReactNode;
  /** localStorage key for persistence. Defaults to a global key shared by all
   *  PDF viewers; pass a per-book key (e.g. `<bookId>:pdf`) to keep themes
   *  per document, like the EPUB reader settings. */
  storageKey?: string;
}

/** Owns the PDF reader background theme and persists the user preference to
 *  localStorage. Rendering stays in pdfjs-dist — this provider only stores
 *  the background color and never touches the PDF file. */
export function PdfThemeProvider({ children, storageKey }: PdfThemeProviderProps) {
  // The storage key is stable for the lifetime of a provider instance (hosts
  // mount one provider per document), so the initial lazy read is enough.
  const [state, setState] = useState<PdfThemeState>(() => loadPdfTheme(storageKey));

  useEffect(() => {
    savePdfTheme(state, storageKey);
  }, [state, storageKey]);

  const setBackground = useCallback((background: string) => {
    setState({ background });
  }, []);

  const reset = useCallback(() => {
    setState({ background: PDF_THEME_DEFAULT_BACKGROUND });
  }, []);

  const value = useMemo(() => ({ state, setBackground, reset }), [state, setBackground, reset]);

  return <PdfThemeContext.Provider value={value}>{children}</PdfThemeContext.Provider>;
}