import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { getSystemTheme } from "./app/providers/theme/ThemeContext";

import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";

import "./styles/reset.css";
import "./styles/variables.css";
import "./styles/animations.css";
import "./styles/global.css";

document.documentElement.dataset.theme = getSystemTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
