/**
 * Ink palette offered wherever text colour is picked — the editor's block
 * colour picker and the shared export dialog. Lives in `shared` because both
 * the document editor and the reading view's export need it, and neither
 * should depend on the other's feature folder.
 */
export const TEXT_COLORS = [
  { value: "", label: "Default", swatch: "transparent" },
  { value: "#322b26", label: "Ink", swatch: "#322b26" },
  { value: "#5b6b50", label: "Forest", swatch: "#5b6b50" },
  { value: "#b9794c", label: "Terracotta", swatch: "#b9794c" },
  { value: "#8c6248", label: "Warm brown", swatch: "#8c6248" },
  { value: "#435542", label: "Moss", swatch: "#435542" },
  { value: "#6c839f", label: "Slate", swatch: "#6c839f" },
  { value: "#a63d2f", label: "Red", swatch: "#a63d2f" },
] as const;
