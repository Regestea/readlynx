import { Search } from "lucide-react";
import { Input } from "../Input/Input";
import styles from "./SearchBar.module.css";

export function SearchBar() {
  return (
    <div className={styles.searchBar} role="search">
      <Input
        type="search"
        placeholder="Search your library…"
        aria-label="Search your library"
        leading={<Search size={18} strokeWidth={1.8} />}
        trailing={
          <span className={styles.hint} aria-hidden="true">
            <kbd>⌘</kbd>
            <kbd>K</kbd>
          </span>
        }
      />
    </div>
  );
}
