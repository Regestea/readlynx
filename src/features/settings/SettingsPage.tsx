import { AiModelsSection } from "./aiModels/AiModelsSection.tsx";
import styles from "./SettingsPage.module.css";

export function SettingsPage() {
  return (
    <main className={styles.page} aria-label="Settings">
      <div className={styles.intro}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>
          Configure the AI models ReadLynx uses for translation and chat.
        </p>
      </div>

      <AiModelsSection />
    </main>
  );
}