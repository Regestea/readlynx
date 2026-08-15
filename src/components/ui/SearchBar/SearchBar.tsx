import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Search } from "lucide-react";
import type { BookListItem } from "../../../infrastructure/db/entities/types";
import { Input } from "../Input/Input";
import styles from "./SearchBar.module.css";

const MAX_SUGGESTIONS = 8;

interface SearchBarProps {
  /** Called when a suggestion is picked. Without it the search bar shows no
   *  suggestions at all (used by the design showcase). */
  onSelectBook?: (book: BookListItem) => void;
}

/** Library search with a live suggestion dropdown. Books are loaded once on
 *  mount (the header only lives on the home page, next to the shelf). */
export function SearchBar({ onSelectBook }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [books, setBooks] = useState<BookListItem[] | null>(null);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onSelectBook) return;
    let cancelled = false;
    void window.readlynx?.db.listBooks().then((rows) => {
      if (!cancelled) setBooks(rows ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [onSelectBook]);

  /** Keeps the dropdown open while interacting with it; closes on outside
   *  clicks. */
  useEffect(() => {
    if (!focused) return;
    const onDown = (event: MouseEvent) => {
      const wrap = wrapRef.current;
      if (wrap && !wrap.contains(event.target as Node)) {
        setFocused(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [focused]);

  /** ⌘/Ctrl+K from anywhere focuses the search field. */
  useEffect(() => {
    if (!onSelectBook) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onSelectBook]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !books) return [];
    return books
      .filter((book) => book.title.toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS);
  }, [query, books]);

  const showPanel = Boolean(onSelectBook && focused && query.trim() && suggestions.length > 0);

  const pick = (book: BookListItem) => {
    onSelectBook?.(book);
    setQuery("");
    setActiveIndex(-1);
    setFocused(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!suggestions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const book = suggestions[activeIndex >= 0 ? activeIndex : 0];
      if (book) pick(book);
    } else if (event.key === "Escape") {
      setFocused(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
    }
  };

  return (
    <div className={styles.searchBar} role="search" ref={wrapRef}>
      <Input
        ref={inputRef}
        type="search"
        placeholder="Search your library…"
        aria-label="Search your library"
        aria-expanded={showPanel}
        role="combobox"
        leading={<Search size={18} strokeWidth={1.8} />}
        trailing={
          <span className={styles.hint} aria-hidden="true">
            <kbd>⌘</kbd>
            <kbd>K</kbd>
          </span>
        }
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(-1);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
      />

      {showPanel && (
        <div className={styles.panel} role="listbox" aria-label="Book suggestions">
          {suggestions.map((book, index) => (
            <button
              key={book.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`${styles.option} ${index === activeIndex ? styles.optionActive : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(book)}
            >
              <BookOpen size={16} strokeWidth={1.8} className={styles.optionIcon} aria-hidden="true" />
              <span className={styles.optionTitle} dir="auto">
                {book.title}
              </span>
              <span className={styles.optionKind}>{book.kind}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}