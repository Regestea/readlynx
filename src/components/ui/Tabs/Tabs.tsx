import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import styles from "./Tabs.module.css";

export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  content: ReactNode;
}

interface TabsProps {
  tabs: TabItem[];
  defaultValue?: string;
  ariaLabel?: string;
}

export function Tabs({ tabs, defaultValue, ariaLabel }: TabsProps) {
  const [activeId, setActiveId] = useState(defaultValue ?? tabs[0]?.id);
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTab?.id);
    let nextIndex = -1;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;

    if (nextIndex >= 0) {
      event.preventDefault();
      setActiveId(tabs[nextIndex].id);
      const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='tab']");
      buttons[nextIndex]?.focus();
    }
  };

  if (!activeTab) return null;

  return (
    <div className={styles.tabs}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={styles.tablist}
        onKeyDown={handleKeyDown}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={tab.id === activeTab.id}
            aria-controls={`panel-${tab.id}`}
            className={`${styles.tab} ${tab.id === activeTab.id ? styles.tabActive : ""}`}
            onClick={() => setActiveId(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
      <div
        key={activeTab.id}
        role="tabpanel"
        id={`panel-${activeTab.id}`}
        aria-labelledby={`tab-${activeTab.id}`}
        className={styles.panel}
      >
        {activeTab.content}
      </div>
    </div>
  );
}
