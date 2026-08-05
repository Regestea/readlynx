import { useState } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2, RefreshCw, XCircle } from "lucide-react";
import type { AiModel } from "../../../../db/entities/AiModel.ts";
import { Button } from "../../../../components/ui/Button/Button";
import { Input } from "../../../../components/ui/Input/Input";
import { Modal } from "../../../../components/ui/Modal/Modal";
import { Select } from "../../../../components/ui/Select/Select";
import { PROVIDER_OPTIONS } from "../types.ts";
import type { AiModelFormErrors } from "../types.ts";
import type { GeminiModelOption } from "../hooks/useAiModelForm.ts";
import styles from "../aiModels.module.css";

interface AiModelFormModalProps {
  isOpen: boolean;
  isEditing: boolean;
  formModel: AiModel;
  formErrors: AiModelFormErrors;
  testApiSuccess: boolean;
  isTestingApi: boolean;
  testApiError: string | null;
  geminiModels: GeminiModelOption[];
  isLoadingGeminiModels: boolean;
  geminiModelsError: string | null;
  onProviderChange: (provider: AiModel["Provider"]) => void;
  onFieldChange: (field: Exclude<keyof AiModel, "Provider">, value: string) => void;
  onTestApiKey: () => void;
  onFetchGeminiModels: () => void;
  onSave: () => void;
  onClose: () => void;
}

export function AiModelFormModal({
  isOpen,
  isEditing,
  formModel,
  formErrors,
  testApiSuccess,
  isTestingApi,
  testApiError,
  geminiModels,
  isLoadingGeminiModels,
  geminiModelsError,
  onProviderChange,
  onFieldChange,
  onTestApiKey,
  onFetchGeminiModels,
  onSave,
  onClose,
}: AiModelFormModalProps) {
  const [showKey, setShowKey] = useState(false);
  const isGemini = formModel.Provider === "GoogleGemini";
  const isCompatible = formModel.Provider === "OpenAiCompatible";

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={isEditing ? "Edit AI model" : "Add AI model"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={isTestingApi || !testApiSuccess}>
            {isEditing ? "Save changes" : "Add model"}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="ai-display-name">
            Display name
          </label>
          <Input
            id="ai-display-name"
            placeholder="My favorite model"
            value={formModel.DisplayName ?? ""}
            onChange={(event) => onFieldChange("DisplayName", event.target.value)}
          />
          {formErrors.DisplayName && (
            <span className={styles.fieldError} role="alert">
              {formErrors.DisplayName}
            </span>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="ai-provider">
            Provider
          </label>
          <Select
            id="ai-provider"
            options={PROVIDER_OPTIONS}
            value={formModel.Provider}
            onChange={(event) => onProviderChange(event.target.value as AiModel["Provider"])}
            aria-label="Provider"
          />
        </div>

        {isGemini ? (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Model</span>
            {geminiModels.length === 0 && (
              <span className={styles.geminiHint}>
                Save the API key, then load the available Gemini models and pick one below.
              </span>
            )}
            {geminiModels.length > 0 ? (
              <div className={styles.geminiRow}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="ai-gemini-list">
                    Gemini models
                  </label>
                  <Select
                    id="ai-gemini-list"
                    options={geminiModels}
                    value={formModel.ModelName ?? ""}
                    onChange={(event) => onFieldChange("ModelName", event.target.value)}
                    aria-label="Gemini models"
                  />
                </div>
              </div>
            ) : (
              <div>
                <Button
                  variant="secondary"
                  onClick={onFetchGeminiModels}
                  disabled={isLoadingGeminiModels || !formModel.APIKey}
                >
                  <span className={styles.geminiRefresh}>
                    {isLoadingGeminiModels ? (
                      <Loader2 size={16} strokeWidth={1.8} className={styles.spin} />
                    ) : (
                      <RefreshCw size={16} strokeWidth={1.8} />
                    )}
                    Load Gemini models
                  </span>
                </Button>
              </div>
            )}
            {isLoadingGeminiModels && (
              <span className={styles.geminiHint}>Fetching available models…</span>
            )}
            {geminiModelsError && (
              <span className={styles.geminiError} role="alert">
                {geminiModelsError}
              </span>
            )}
            {formErrors.ModelName && (
              <span className={styles.fieldError} role="alert">
                {formErrors.ModelName}
              </span>
            )}
          </div>
        ) : (
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="ai-model-name">
              Model name
            </label>
            <Input
              id="ai-model-name"
              placeholder="gpt-4o"
              value={formModel.ModelName ?? ""}
              onChange={(event) => onFieldChange("ModelName", event.target.value)}
            />
            {formErrors.ModelName && (
              <span className={styles.fieldError} role="alert">
                {formErrors.ModelName}
              </span>
            )}
          </div>
        )}

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="ai-api-key">
            API key
          </label>
          <Input
            id="ai-api-key"
            type={showKey ? "text" : "password"}
            placeholder="sk-…"
            autoComplete="off"
            value={formModel.APIKey ?? ""}
            onChange={(event) => onFieldChange("APIKey", event.target.value)}
            trailing={
              <button
                type="button"
                onClick={() => setShowKey((shown) => !shown)}
                aria-label={showKey ? "Hide API key" : "Show API key"}
                className={styles.passwordToggle}
              >
                {showKey ? (
                  <EyeOff size={16} strokeWidth={1.8} />
                ) : (
                  <Eye size={16} strokeWidth={1.8} />
                )}
              </button>
            }
          />
          {formErrors.APIKey && (
            <span className={styles.fieldError} role="alert">
              {formErrors.APIKey}
            </span>
          )}
        </div>

        {isCompatible && (
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="ai-url">
              Base URL
            </label>
            <Input
              id="ai-url"
              placeholder="https://api.example.com/v1"
              value={formModel.URL ?? ""}
              onChange={(event) => onFieldChange("URL", event.target.value)}
            />
            {formErrors.URL && (
              <span className={styles.fieldError} role="alert">
                {formErrors.URL}
              </span>
            )}
          </div>
        )}

        <div className={styles.testRow}>
          <Button variant="ghost" onClick={onTestApiKey} disabled={isTestingApi}>
            {isTestingApi ? "Testing…" : "Test connection"}
          </Button>
          {isTestingApi && (
            <span className={`${styles.testStatus} ${styles.testBusy}`}>
              <Loader2 size={16} strokeWidth={1.8} className={styles.spin} />
              Connecting…
            </span>
          )}
          {!isTestingApi && testApiSuccess && (
            <span className={`${styles.testStatus} ${styles.testOk}`} role="status">
              <CheckCircle2 size={16} strokeWidth={1.8} />
              Connected successfully
            </span>
          )}
          {!isTestingApi && testApiError && (
            <span className={`${styles.testStatus} ${styles.testFail}`} role="alert">
              <XCircle size={16} strokeWidth={1.8} />
              {testApiError}
            </span>
          )}
          {!isTestingApi && !testApiSuccess && !testApiError && (
            <span className={styles.testHint} role="status">
              Test the connection to enable saving.
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}