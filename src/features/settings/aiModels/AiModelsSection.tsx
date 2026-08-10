import { useState } from "react";
import { Bot, Plus } from "lucide-react";
import { Card } from "../../../components/ui/Card/Card";
import { Button } from "../../../components/ui/Button/Button";
import { Modal } from "../../../components/ui/Modal/Modal";
import { useAiModels } from "./hooks/useAiModels.ts";
import { useAiModelForm } from "./hooks/useAiModelForm.ts";
import { AiModelList } from "./components/AiModelList.tsx";
import { AiModelFormModal } from "./components/AiModelFormModal.tsx";
import styles from "./aiModels.module.css";

/** AI Models management, shown inside the Settings page. */
export function AiModelsSection() {
  const { models, addModel, updateModel, deleteModel, setDefaultModel } = useAiModels();
  const form = useAiModelForm();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const openAddModal = () => {
    form.openAdd();
    setIsModalOpen(true);
  };

  const closeModal = () => {
    form.reset();
    setIsModalOpen(false);
  };

  const handleSave = async () => {
    if (!form.validate()) return;

    if (form.editingId) {
      const updated = { ...form.formModel, Id: form.editingId };
      await updateModel(updated);
    } else {
      await addModel({ ...form.formModel, Id: crypto.randomUUID() });
    }
    closeModal();
  };

  const handleDeleteConfirm = async () => {
    if (deleteTargetId) {
      await deleteModel(deleteTargetId);
      setDeleteTargetId(null);
    }
  };

  return (
    <Card className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitleRow}>
          <span className={styles.sectionIcon} aria-hidden="true">
            <Bot size={16} strokeWidth={1.8} />
          </span>
          <h2 className={styles.sectionTitle}>AI Models</h2>
        </div>
        <p className={styles.sectionDesc}>
          Connect the language models ReadLynx uses for AI features. Keys are stored locally in
          your library database. The model marked as “Default” is used automatically by the
          reading-mode translator.
        </p>
      </div>

      <AiModelList
        models={models}
        onEdit={(model) => {
          form.openEdit(model);
          setIsModalOpen(true);
        }}
        onDelete={(id) => setDeleteTargetId(id)}
        onSetDefault={(id) => void setDefaultModel(id)}
      />

      <div className={styles.addRow}>
        <Button onClick={openAddModal}>
          <Plus size={16} strokeWidth={2} aria-hidden="true" />
          Add model
        </Button>
      </div>

      <AiModelFormModal
        isOpen={isModalOpen}
        isEditing={!!form.editingId}
        formModel={form.formModel}
        formErrors={form.formErrors}
        testApiSuccess={form.testApiSuccess}
        isTestingApi={form.isTestingApi}
        testApiError={form.testApiError}
        geminiModels={form.geminiModels}
        isLoadingGeminiModels={form.isLoadingGeminiModels}
        geminiModelsError={form.geminiModelsError}
        onProviderChange={form.handleProviderChange}
        onFieldChange={form.handleFieldChange}
        onTestApiKey={form.testApiKey}
        onFetchGeminiModels={() =>
          form.fetchGeminiModels(form.formModel.APIKey ?? "").catch(() => undefined)
        }
        onSave={handleSave}
        onClose={closeModal}
      />

      <Modal
        open={deleteTargetId !== null}
        onClose={() => setDeleteTargetId(null)}
        title="Delete AI model"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTargetId(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDeleteConfirm}>
              Delete
            </Button>
          </>
        }
      >
        <p>Are you sure you want to delete this AI model?</p>
      </Modal>
    </Card>
  );
}