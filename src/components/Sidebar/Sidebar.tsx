import {
  BookOpen,
  FolderOpen,
  Heart,
  Home,
  Library,
  NotebookPen,
  Settings,
  Users,
} from "lucide-react";
import { Avatar } from "../ui/Avatar/Avatar";
import styles from "./Sidebar.module.css";

const NAV_GROUPS = [
  {
    label: "Menu",
    items: [
      { id: "home", label: "Home", Icon: Home },
      { id: "library", label: "Library", Icon: Library },
    ],
  },
  {
    label: "Library",
    items: [
      { id: "currently-reading", label: "Currently Reading", Icon: BookOpen },
      { id: "favorites", label: "Favorites", Icon: Heart },
      { id: "collections", label: "Collections", Icon: FolderOpen },
      { id: "notes", label: "Notes", Icon: NotebookPen },
      { id: "authors", label: "Authors", Icon: Users },
    ],
  },
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
      title={label}
      onClick={onClick}
    >
      <Icon size={18} strokeWidth={1.8} className={styles.navIcon} aria-hidden="true" />
      <span>{label}</span>
      {active && <span className={styles.activeDot} aria-hidden="true" />}
    </button>
  );
}

interface SidebarProps {
  activeId: string;
  onNavigate: (id: string) => void;
}

export function Sidebar({ activeId, onNavigate }: SidebarProps) {
  return (
    <aside className={`${styles.sidebar} animate-slide-in`} aria-label="Primary">
      <div className={styles.brand}>
        <span className={styles.logo} aria-hidden="true">
          <BookOpen size={22} strokeWidth={1.8} />
        </span>
        <div className={styles.brandText}>
          <span className={styles.name}>ReadLynx</span>
          <span className={styles.tagline}>Quiet mornings, good books</span>
        </div>
      </div>

      <nav className={styles.nav} aria-label="Main menu">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className={styles.group}>
            <p className={styles.sectionLabel}>{group.label}</p>
            {group.items.map((item) => (
              <NavItem
                key={item.id}
                label={item.label}
                Icon={item.Icon}
                active={item.id === activeId}
                onClick={() => onNavigate(item.id)}
              />
            ))}
          </div>
        ))}
        <div className={styles.group}>
          <p className={styles.sectionLabel}>General</p>
          <NavItem
            label="Settings"
            Icon={Settings}
            active={activeId === "settings"}
            onClick={() => onNavigate("settings")}
          />
        </div>
      </nav>

      <div className={styles.profile}>
        <Avatar name="Avery Lane" size={40} />
        <div className={styles.profileText}>
          <span className={styles.profileName}>Avery Lane</span>
          <span className={styles.profileMeta}>Reader · 42 books</span>
        </div>
        <Settings size={16} strokeWidth={1.8} className={styles.profileIcon} aria-hidden="true" />
      </div>
    </aside>
  );
}
