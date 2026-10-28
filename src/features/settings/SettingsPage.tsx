import { AiModelsSection } from "./aiModels/AiModelsSection.tsx";
import { DisplayCard } from "./display/DisplayCard.tsx";
import { FileImportCard } from "./fileImport/FileImportCard.tsx";
import { SelectionTranslationCard } from "./selectionTranslation/SelectionTranslationCard.tsx";
import {
  EpubDefaultsCard,
  PdfDefaultsCard,
  TranslationDefaultsCard,
} from "./readerDefaults/ReaderDefaultsCards.tsx";
import { UpdatesSection } from "./UpdatesSection.tsx";
import styles from "./SettingsPage.module.css";

export function SettingsPage() {
  return (
    <main className={styles.page} aria-label="Settings">
      <div className={styles.intro}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>
          Configure the AI models ReadLynx uses for translation and chat, how files opened from
          the file explorer are imported, and the default reading appearance for newly added
          books.
        </p>
      </div>

      <DisplayCard />
      <SelectionTranslationCard />
      <AiModelsSection />
      <FileImportCard />
      <EpubDefaultsCard />
      <TranslationDefaultsCard />
      <PdfDefaultsCard />
      <UpdatesSection />
    </main>
  );
}