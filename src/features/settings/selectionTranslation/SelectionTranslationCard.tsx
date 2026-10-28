import { useEffect, useMemo, useState } from "react";
import { Languages } from "lucide-react";
import { Card } from "../../../components/ui/Card/Card";
import { Select } from "../../../components/ui/Select/Select";
import type { SelectOption } from "../../../components/ui/Select/Select";
import { useAiModelList } from "../../../infrastructure/ai/useAiModelList";
import type { SelectionTranslationProvider } from "../../../shared/selectionTranslation";
import styles from "./selectionTranslation.module.css";

const OPTIONS: SelectOption[] = [
  { value: "google", label: "Google Translate" },
  { value: "ai", label: "AI model" },
];

/** Provider for the translation circle that appears at the start of a text
 *  selection in the EPUB and Markdown readers. The output language is the
 *  one chosen in the reading toolbar, not a separate setting here. */
export function SelectionTranslationCard() {
  const [provider, setProvider] = useState<SelectionTranslationProvider>("google");
  const [modelId, setModelId] = useState("");
  const { models } = useAiModelList();

  useEffect(() => {
    let cancelled = false;
    void window.readlynx?.db
      .getAppSettings()
      .then((settings) => {
        if (cancelled || !settings) return;
        setProvider(settings.selectionTranslationProvider);
        setModelId(settings.selectionTranslationModelId);
      })
      .catch(() => {
        // No bridge / worker down — the Google default is already on display.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const modelOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: "",
        label: models.length === 0 ? "No models configured" : "App default",
      },
      ...models.map((model) => ({
        value: model.Id,
        label: model.DisplayName ?? model.ModelName ?? model.Id,
      })),
    ],
    [models],
  );

  /** A saved model may have been deleted since it was chosen; the reader then
   *  follows the app default again, which is what an empty value means. */
  const selectedModelId = models.some((model) => model.Id === modelId) ? modelId : "";

  const changeProvider = (value: string) => {
    const next: SelectionTranslationProvider = value === "ai" ? "ai" : "google";
    setProvider(next);
    void window.readlynx?.db
      .updateAppSettings({ selectionTranslationProvider: next })
      .catch(() => false);
  };

  const changeModel = (value: string) => {
    setModelId(value);
    void window.readlynx?.db
      .updateAppSettings({ selectionTranslationModelId: value })
      .catch(() => false);
  };

  return (
    <Card className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitleRow}>
          <span className={styles.sectionIcon} aria-hidden="true">
            <Languages size={16} strokeWidth={1.8} />
          </span>
          <h2 className={styles.sectionTitle}>Selection translation</h2>
        </div>
        <p className={styles.sectionDesc}>
          The circle at the start of a text selection in EPUB and Markdown books. Pick what
          translates it; the output language comes from the reader's top bar.
        </p>
      </div>

      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowLabel}>Provider</span>
          <span className={styles.rowDesc}>
            Google Translate uses the free web endpoint and needs no model. AI uses a saved model
            — the one below, or the app default.
          </span>
        </div>
        <Select
          className={styles.providerSelect}
          options={OPTIONS}
          value={provider}
          onChange={(event) => changeProvider(event.target.value)}
          aria-label="Selection translation provider"
        />
      </div>

      {provider === "ai" && (
        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>Model</span>
            <span className={styles.rowDesc}>
              Used for AI selection translation. “App default” follows the default model in
              Settings → AI Models.
            </span>
          </div>
          <Select
            className={styles.modelSelect}
            options={modelOptions}
            value={selectedModelId}
            onChange={(event) => changeModel(event.target.value)}
            aria-label="Selection translation AI model"
            disabled={models.length === 0}
          />
        </div>
      )}
    </Card>
  );
}
