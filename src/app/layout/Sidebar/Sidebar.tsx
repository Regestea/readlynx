import {
  BookOpen,
  DatabaseBackup,
  Home,
  Moon,
  Settings,
  Sun,
} from "lucide-react";
import { useTheme } from "../../providers/theme/ThemeContext";
import styles from "./Sidebar.module.css";

const NAV_ITEMS = [
  { id: "home", label: "Home", Icon: Home },
  { id: "backup", label: "Backup & Restore", Icon: DatabaseBackup },
  { id: "settings", label: "Settings", Icon: Settings },
] as const;

interface NavItemProps {
  label: string;
  Icon: typeof Home;
  active: boolean;
  onClick: () => void;
}

function NavItem({ label, Icon, active, onClick }: NavItemProps) {
  return (
    <button
      type="button"
      className={`${styles.navItem} ${active ? styles.active : ""}`}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon size={18} strokeWidth={1.8} className={styles.navIcon} aria-hidden="true" />
    </button>
  );
}

interface SidebarProps {
  activeId: string;
  onNavigate: (id: string) => void;
}

export function Sidebar({ activeId, onNavigate }: SidebarProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <aside className={styles.sidebar} aria-label="Primary">
      <div className={styles.brand}>
        <span className={styles.logo} aria-hidden="true">
          <BookOpen size={22} strokeWidth={1.8} />
        </span>
      </div>

      <nav className={styles.nav} aria-label="Main menu">
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.id}
            label={item.label}
            Icon={item.Icon}
            active={item.id === activeId}
            onClick={() => onNavigate(item.id)}
          />
        ))}
      </nav>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.themeToggle}
          onClick={toggleTheme}
          aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
          title="Change theme"
        >
          <span className={styles.iconStack} aria-hidden="true">
            <Sun
              size={18}
              strokeWidth={1.8}
              className={`${styles.themeIcon} ${isDark ? styles.themeIconHidden : ""}`}
            />
            <Moon
              size={18}
              strokeWidth={1.8}
              className={`${styles.themeIcon} ${isDark ? "" : styles.themeIconHidden}`}
            />
          </span>
        </button>
      </div>
    </aside>
  );
}
