import type { MarkdownBlockTheme } from "../../infrastructure/db/entities/ReaderSettings.ts";

/** Mermaid "base" themes recolored from the app's design tokens so diagrams
 *  match the active theme (calm mountain morning / moonlit mountain evening)
 *  instead of mermaid's defaults. The svg background stays transparent so
 *  the card surface shows through. */
export const MERMAID_LIGHT_THEME = {
  theme: "base",
  themeVariables: {
    background: "transparent",
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    primaryColor: "#fff8f0",
    primaryTextColor: "#322b26",
    primaryBorderColor: "#5b6b50",
    secondaryColor: "#efe3d2",
    secondaryTextColor: "#4c382b",
    tertiaryColor: "#e6ded0",
    lineColor: "#6f675e",
    textColor: "#322b26",
    edgeLabelBackground: "#fff8f0",
    clusterBkg: "rgba(239, 227, 210, 0.55)",
    clusterBorder: "#9b9289",
    noteBkgColor: "rgba(239, 227, 210, 0.8)",
    noteBorderColor: "#9b9289",
    titleColor: "#322b26",
  },
} as const;

export const MERMAID_DARK_THEME = {
  theme: "base",
  themeVariables: {
    background: "transparent",
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    primaryColor: "#1f2b43",
    primaryTextColor: "#eef2f7",
    primaryBorderColor: "#8fa8c7",
    secondaryColor: "#162033",
    secondaryTextColor: "#d9e0ee",
    tertiaryColor: "#2c3a57",
    lineColor: "#c5ccd8",
    textColor: "#eef2f7",
    edgeLabelBackground: "#1f2b43",
    clusterBkg: "rgba(22, 32, 51, 0.7)",
    clusterBorder: "#95a0b2",
    noteBkgColor: "rgba(44, 58, 87, 0.8)",
    noteBorderColor: "#95a0b2",
    titleColor: "#eef2f7",
  },
} as const;

/** The theme config for a resolved light/dark mode. */
export function mermaidConfig(theme: MarkdownBlockTheme): Record<string, unknown> {
  return theme === "dark" ? MERMAID_DARK_THEME : MERMAID_LIGHT_THEME;
}
