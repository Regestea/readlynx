import {
  BookOpen,
  DatabaseBackup,
  Home,
  Loader2,
  Moon,
  RefreshCw,
  Settings,
  Sparkles,
  Sun,
} from "lucide-react";
import { useTheme } from "../../providers/theme/ThemeContext";
import { useUpdater } from "../../../features/updater/UpdaterContext";
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

/** The update button in the footer: a dot marks a waiting release, the icon
 *  shows what the button does right now (check, download, install). */
function UpdateButton() {
  const { check, hasUpdate, phase, openDialog, checkNow } = useUpdater();

  const checking = check.kind === "checking";
  const busy = phase !== null;
  const version = check.kind === "done" ? check.result.latestVersion : null;
  const label = busy
    ? "Update in progress"
    : hasUpdate
      ? `ReadLynx ${version ?? ""} is available — install it`
      : checking
        ? "Checking for updates"
        : "Check for updates";

  const handleClick = () => {
    openDialog();
    // The dialog explains itself with the last answer; asking GitHub again the
    // first time it is opened fills it in.
    if (check.kind === "idle") void checkNow();
  };

  const Icon = busy ? Loader2 : hasUpdate ? Sparkles : RefreshCw;

  return (
    <button
      type="button"
      className={`${styles.themeToggle} ${hasUpdate && !busy ? styles.updateButtonActive : ""}`}
      onClick={handleClick}
      aria-label={label}
      title={label}
    >
      <Icon
        size={18}
        strokeWidth={1.8}
        aria-hidden="true"
        className={busy || checking ? styles.updateSpinner : undefined}
      />
      {hasUpdate && !busy && <span className={styles.updateBadge} aria-hidden="true" />}
    </button>
  );
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
        <UpdateButton />

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
