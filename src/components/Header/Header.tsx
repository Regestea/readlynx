import { Bell, Moon, Sun } from "lucide-react";
import { useTheme } from "../../app/providers/theme/ThemeContext";
import { greetingByHour } from "../../shared/utils";
import { Avatar } from "../ui/Avatar/Avatar";
import { Button } from "../ui/Button/Button";
import { SearchBar } from "../ui/SearchBar/SearchBar";
import styles from "./Header.module.css";

export function Header() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <header className={`${styles.header} animate-fade-up`}>
      <div className={styles.greeting}>
        <h1 className={styles.title}>
          {greetingByHour()}, Avery
        </h1>
        <p className={styles.subtitle}>You have 3 books waiting for you.</p>
      </div>

      <SearchBar />

      <div className={styles.actions}>
        <Button variant="icon" className={styles.notifyWrap} aria-label="Notifications">
          <Bell size={20} strokeWidth={1.8} aria-hidden="true" />
          <span className={styles.badge} aria-hidden="true" />
        </Button>

        <Button
          variant="icon"
          aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
          aria-pressed={isDark}
          onClick={toggleTheme}
        >
          <span className={styles.iconStack} aria-hidden="true">
            <Sun
              size={20}
              strokeWidth={1.8}
              className={`${styles.themeIcon} ${isDark ? styles.themeIconHidden : ""}`}
            />
            <Moon
              size={20}
              strokeWidth={1.8}
              className={`${styles.themeIcon} ${isDark ? "" : styles.themeIconHidden}`}
            />
          </span>
        </Button>

        <Avatar name="Avery Lane" size={44} />
      </div>
    </header>
  );
}
