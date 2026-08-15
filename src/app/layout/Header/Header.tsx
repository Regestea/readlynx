import type { BookListItem } from "../../../infrastructure/db/entities/types";
import { SearchBar } from "../../../components/ui/SearchBar/SearchBar";
import styles from "./Header.module.css";

interface HeaderProps {
  /** Opens the picked book — called with the suggestion clicked in the
   *  search dropdown. */
  onSelectBook?: (book: BookListItem) => void;
}

export function Header({ onSelectBook }: HeaderProps) {
  return (
    <header className={`${styles.header} animate-fade-up`}>
      <div className={styles.search}>
        <SearchBar onSelectBook={onSelectBook} />
      </div>
    </header>
  );
}