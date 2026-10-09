import { useCallback, useMemo, useReducer } from "react";
import type { CreateBookDetails } from "../features/home/components/CreateBookDialog";

/** One open view in the title bar.
 *
 *  `id` is the React key and is derived from what the tab *is*, never from a
 *  counter: reopening a book focuses the tab already showing it instead of
 *  stacking duplicates, and the id cannot drift when the tab's own state moves
 *  on (the reader turning a page changes nothing about which tab it is). */
export type Tab =
  | { id: "home"; kind: "home"; title: string }
  | { id: "settings"; kind: "settings"; title: string }
  | { id: "backup"; kind: "backup"; title: string }
  | { id: string; kind: "reading"; title: string; bookId: string }
  | { id: string; kind: "create"; title: string; bookId: string | null; details: CreateBookDetails | null };

export const HOME_TAB: Tab = { id: "home", kind: "home", title: "Library" };

/** Only books can be closed. Library, Settings and Backup are places the
 *  sidebar can always return to, so their tabs are bookmarks rather than
 *  something to dismiss — and closing Library would leave no way back to the
 *  shelf at all. */
export function isClosableTab(tab: Tab): boolean {
  return tab.kind === "reading" || tab.kind === "create";
}

export const readingTabId = (bookId: string) => `reading:${bookId}`;

/** A brand-new document has no book id yet, so it shares one tab: two unsaved
 *  "new book" drafts side by side would be indistinguishable in the bar. */
export const createTabId = (bookId: string | null) => `create:${bookId ?? "new"}`;

interface TabsState {
  tabs: Tab[];
  activeId: string;
}

type TabsAction =
  | { type: "open"; tab: Tab }
  | { type: "activate"; id: string }
  | { type: "close"; id: string }
  | { type: "rename"; id: string; title: string }
  | { type: "move"; id: string; toIndex: number };

function reducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case "open": {
      const existing = state.tabs.findIndex((tab) => tab.id === action.tab.id);
      // Re-opening an open tab focuses it, and refreshes what the caller
      // passed (an editor re-seeded from the home shelf, say) without the tab
      // losing its place or its state.
      const tabs =
        existing === -1
          ? [...state.tabs, action.tab]
          : state.tabs.map((tab, index) =>
              // The title is deliberately kept from the tab already in the bar.
              // Callers open a book with only its id, so they pass a
              // placeholder; without this, reopening a book would replace the
              // title its page just reported with "Loading…".
              index === existing ? { ...action.tab, title: tab.title } : tab,
            );
      return { tabs, activeId: action.tab.id };
    }
    case "activate":
      return state.tabs.some((tab) => tab.id === action.id)
        ? { ...state, activeId: action.id }
        : state;
    case "close": {
      // The bar always keeps one tab, so there is nothing left to focus.
      if (state.tabs.length <= 1) return state;
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index === -1) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== action.id);
      // Hand focus to the neighbour that took the closed tab's place, or the
      // new last tab when the rightmost one closed.
      const activeId =
        state.activeId === action.id
          ? tabs[Math.min(index, tabs.length - 1)].id
          : state.activeId;
      return { tabs, activeId };
    }
    case "rename": {
      // A tab is opened before the page has loaded, so its label is a
      // placeholder until the real book title arrives. A blank title means the
      // page has nothing better to say yet, which keeps the placeholder.
      if (!action.title.trim()) return state;
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index === -1 || state.tabs[index].title === action.title) return state;
      const tabs = [...state.tabs];
      tabs[index] = { ...tabs[index], title: action.title };
      return { ...state, tabs };
    }
    case "move": {
      const from = state.tabs.findIndex((tab) => tab.id === action.id);
      const to = Math.max(0, Math.min(action.toIndex, state.tabs.length - 1));
      if (from === -1 || from === to) return state;
      const tabs = [...state.tabs];
      tabs.splice(from, 1);
      tabs.splice(to, 0, state.tabs[from]);
      return { ...state, tabs };
    }
    default:
      return state;
  }
}

/** The window's open views. Every tab stays mounted while it is in the bar —
 *  switching hides it instead of unmounting it, so the reader keeps its page,
 *  scroll and translation and switching is instant. */
export function useTabs() {
  const [state, dispatch] = useReducer(reducer, {
    tabs: [HOME_TAB],
    activeId: HOME_TAB.id,
  });

  const openTab = useCallback((tab: Tab) => dispatch({ type: "open", tab }), []);
  const activateTab = useCallback((id: string) => dispatch({ type: "activate", id }), []);
  const closeTab = useCallback((id: string) => dispatch({ type: "close", id }), []);
  const renameTab = useCallback((id: string, title: string) => dispatch({ type: "rename", id, title }), []);
  const moveTab = useCallback((id: string, toIndex: number) => dispatch({ type: "move", id, toIndex }), []);

  const activeTab = useMemo(
    () => state.tabs.find((tab) => tab.id === state.activeId) ?? state.tabs[0],
    [state.tabs, state.activeId],
  );

  return {
    tabs: state.tabs,
    activeTab,
    activeId: state.activeId,
    openTab,
    activateTab,
    closeTab,
    renameTab,
    moveTab,
  };
}