import { useState } from "react";
import {
  Bell,
  BookOpen,
  Check,
  Moon,
  Palette,
  Sun,
  User,
} from "lucide-react";
import { useTheme } from "../../../app/providers/theme/ThemeContext";
import { Avatar } from "../../../components/ui/Avatar/Avatar";
import { Button } from "../../../components/ui/Button/Button";
import { Card } from "../../../components/ui/Card/Card";
import { Checkbox } from "../../../components/ui/Checkbox/Checkbox";
import { ColorSelect } from "../../../components/ui/ColorSelect/ColorSelect";
import { Input } from "../../../components/ui/Input/Input";
import { NumberInput } from "../../../components/ui/NumberInput/NumberInput";
import { Select } from "../../../components/ui/Select/Select";
import type { SelectOption } from "../../../components/ui/Select/Select";
import type { Theme } from "../../../shared/types";
import { AiModelsSection } from "../aiModels/AiModelsSection.tsx";
import styles from "./SettingsPage.module.css";

interface SectionProps {
  title: string;
  description?: string;
  Icon: typeof Palette;
  children: React.ReactNode;
}

function Section({ title, description, Icon, children }: SectionProps) {
  return (
    <Card className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitleRow}>
          <span className={styles.sectionIcon} aria-hidden="true">
            <Icon size={16} strokeWidth={1.8} />
          </span>
          <h2 className={styles.sectionTitle}>{title}</h2>
        </div>
        {description && <p className={styles.sectionDesc}>{description}</p>}
      </div>
      {children}
    </Card>
  );
}

const LIBRARY_VIEW_OPTIONS: SelectOption[] = [
  { value: "grid", label: "Grid" },
  { value: "list", label: "List" },
  { value: "table", label: "Table" },
];

const PAGE_SCROLL_OPTIONS: SelectOption[] = [
  { value: "continuous", label: "Continuous scroll" },
  { value: "paged", label: "Paged (book-like)" },
];

export function SettingsPage() {
  const { theme, setTheme } = useTheme();

  const [name, setName] = useState("Avery Lane");
  const [email, setEmail] = useState("avery@readlynx.app");
  const [dailyGoal, setDailyGoal] = useState(30);
  const [libraryView, setLibraryView] = useState("grid");
  const [scrollMode, setScrollMode] = useState("continuous");
  const [accent, setAccent] = useState("#5b6b50");
  const [prefs, setPrefs] = useState({
    weekly: true,
    suggestions: true,
    highlights: false,
  });
  const [saved, setSaved] = useState(false);

  const chooseTheme = (next: Theme) => {
    setTheme(next);
  };

  const handleSave = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <main className={styles.page} aria-label="Settings">
      <div className={styles.intro}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>
          Personalize ReadLynx — appearance, reading habits and notifications.
        </p>
      </div>

      <Section
        title="Appearance"
        description="Choose how ReadLynx looks. The theme applies instantly and is saved to your library."
        Icon={Palette}
      >
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Theme</span>
          <div className={styles.themeOptions}>
            <button
              type="button"
              className={`${styles.themeOption} ${theme === "light" ? styles.themeOptionActive : ""}`}
              onClick={() => chooseTheme("light")}
              aria-pressed={theme === "light"}
            >
              <span className={`${styles.themeSwatch} ${styles.swatchLight}`} aria-hidden="true">
                <Sun size={18} strokeWidth={1.8} />
              </span>
              Light
            </button>
            <button
              type="button"
              className={`${styles.themeOption} ${theme === "dark" ? styles.themeOptionActive : ""}`}
              onClick={() => chooseTheme("dark")}
              aria-pressed={theme === "dark"}
            >
              <span className={`${styles.themeSwatch} ${styles.swatchDark}`} aria-hidden="true">
                <Moon size={18} strokeWidth={1.8} />
              </span>
              Dark
            </button>
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Accent color</span>
            <ColorSelect value={accent} onChange={setAccent} label="Accent color" />
          </div>
        </div>
      </Section>

      <Section
        title="Reading"
        description="Tune how the library and readers behave."
        Icon={BookOpen}
      >
        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="daily-goal" className={styles.fieldLabel}>
              Daily reading goal
            </label>
            <NumberInput
              id="daily-goal"
              value={dailyGoal}
              min={5}
              max={240}
              step={5}
              onChange={setDailyGoal}
              label="Daily reading goal in minutes"
            />
            <span className={styles.fieldHint}>{dailyGoal} minutes per day</span>
          </div>
          <div className={styles.field}>
            <label htmlFor="library-view" className={styles.fieldLabel}>
              Library default view
            </label>
            <Select
              id="library-view"
              options={LIBRARY_VIEW_OPTIONS}
              value={libraryView}
              onChange={(event) => setLibraryView(event.target.value)}
              aria-label="Library default view"
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="scroll-mode" className={styles.fieldLabel}>
              Page scrolling
            </label>
            <Select
              id="scroll-mode"
              options={PAGE_SCROLL_OPTIONS}
              value={scrollMode}
              onChange={(event) => setScrollMode(event.target.value)}
              aria-label="Page scrolling"
            />
          </div>
        </div>
      </Section>

      <Section
        title="Notifications"
        description="Choose what ReadLynx sends you."
        Icon={Bell}
      >
        <div className={styles.optionList}>
          <div className={styles.optionRow}>
            <div className={styles.optionText}>
              <span className={styles.optionLabel}>Weekly reading summary</span>
              <span className={styles.optionDesc}>A recap of minutes read and books finished</span>
            </div>
            <Checkbox
              checked={prefs.weekly}
              onChange={(checked) => setPrefs((current) => ({ ...current, weekly: checked }))}
              label=""
            />
          </div>
          <div className={styles.optionRow}>
            <div className={styles.optionText}>
              <span className={styles.optionLabel}>Book suggestions</span>
              <span className={styles.optionDesc}>Recommendations based on your library</span>
            </div>
            <Checkbox
              checked={prefs.suggestions}
              onChange={(checked) => setPrefs((current) => ({ ...current, suggestions: checked }))}
              label=""
            />
          </div>
          <div className={styles.optionRow}>
            <div className={styles.optionText}>
              <span className={styles.optionLabel}>Share highlights</span>
              <span className={styles.optionDesc}>Publish highlighted passages automatically</span>
            </div>
            <Checkbox
              checked={prefs.highlights}
              onChange={(checked) => setPrefs((current) => ({ ...current, highlights: checked }))}
              label=""
            />
          </div>
        </div>
      </Section>

      <AiModelsSection />

      <Section
        title="Profile"
        description="Your reader identity."
        Icon={User}
      >
        <div className={styles.profileRow}>
          <Avatar name={name.trim() || "Avery Lane"} size={64} />
          <div className={styles.profileFields}>
            <Input
              placeholder="Display name"
              aria-label="Display name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Input
              placeholder="Email address"
              aria-label="Email address"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
        </div>
      </Section>

      <div className={styles.actions}>
        {saved && (
          <span className={styles.saved} role="status">
            <Check size={16} strokeWidth={2} aria-hidden="true" />
            Saved
          </span>
        )}
        <Button variant="secondary" onClick={() => setSaved(false)}>
          Reset
        </Button>
        <Button onClick={handleSave}>Save changes</Button>
      </div>
    </main>
  );
}
