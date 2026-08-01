export const FONT_FAMILY_OPTIONS = [
  { value: "", label: "Default" },
  { value: "Inter, sans-serif", label: "Inter" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "Times New Roman, serif", label: "Times New Roman" },
  { value: "Courier New, monospace", label: "Courier New" },
  { value: "Vazirmatn, Tahoma, sans-serif", label: "Vazirmatn (فارسی)" },
  { value: "Noto Sans Arabic, Segoe UI, sans-serif", label: "Noto Arabic (العربية)" },
] as const;

export const FONT_SIZE_OPTIONS = [
  { value: "", label: "Default" },
  { value: "12px", label: "12px" },
  { value: "14px", label: "14px" },
  { value: "16px", label: "16px" },
  { value: "18px", label: "18px" },
  { value: "20px", label: "20px" },
  { value: "24px", label: "24px" },
  { value: "28px", label: "28px" },
  { value: "32px", label: "32px" },
] as const;

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

export const BACKGROUND_COLORS = [
  { value: "", label: "None", swatch: "transparent" },
  { value: "#fff3d9", label: "Sand", swatch: "#fff3d9" },
  { value: "#e4edd9", label: "Mint", swatch: "#e4edd9" },
  { value: "#e3ecf5", label: "Ice", swatch: "#e3ecf5" },
  { value: "#f9e2d7", label: "Apricot", swatch: "#f9e2d7" },
  { value: "#efe6f7", label: "Lavender", swatch: "#efe6f7" },
] as const;

export const HEADING_OPTIONS = [
  { value: "paragraph", label: "Paragraph" },
  { value: "h1", label: "Heading 1" },
  { value: "h2", label: "Heading 2" },
  { value: "h3", label: "Heading 3" },
  { value: "h4", label: "Heading 4" },
  { value: "h5", label: "Heading 5" },
  { value: "h6", label: "Heading 6" },
] as const;

export const PLACEHOLDER_TEXT = "Start writing…";
