import { Bell } from "lucide-react";
import { Avatar } from "../../../components/ui/Avatar/Avatar";
import { Button } from "../../../components/ui/Button/Button";
import { SearchBar } from "../../../components/ui/SearchBar/SearchBar";
import styles from "./Header.module.css";

export function Header() {
  return (
    <header className={`${styles.header} animate-fade-up`}>
      <div className={styles.search}>
        <SearchBar />
      </div>

      <div className={styles.actions}>
        <Button variant="icon" className={styles.notifyWrap} aria-label="Notifications">
          <Bell size={20} strokeWidth={1.8} aria-hidden="true" />
          <span className={styles.badge} aria-hidden="true" />
        </Button>

        <Avatar name="Avery Lane" size={44} />
      </div>
    </header>
  );
}
