import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import type { CustomInstructionEntity } from "../../infrastructure/db/entities/CustomInstruction.ts";
import { Button } from "../ui/Button/Button";
import { Input } from "../ui/Input/Input";
import { TextArea } from "../ui/TextArea/TextArea";
import { Modal } from "../ui/Modal/Modal";
import styles from "./CustomInstructionsModal.module.css";

interface CustomInstructionsModalProps {
  open: boolean;
  onClose: () => void;
  /** Id of the instruction currently in use ("" = none). */
  selectedId: string;
  /** Called with the updated instruction after the currently selected one is
   *  edited (its id does not change, so the caller's id-keyed effect would
   *  not re-run). */
  onSelectedEdited?: (instruction: CustomInstructionEntity) => void;
  /** Called after the currently selected instruction is deleted. */
  onSelectedDeleted?: () => void;
}

interface Draft {
  id: string | null;
  name: string;
  content: string;
}

/** Manager for the user's saved instruction templates: create, edit and
 *  delete the prompts offered by every instruction select. */
export function CustomInstructionsModal({
  open,
  onClose,
  selectedId,
  onSelectedEdited,
  onSelectedDeleted,
}: CustomInstructionsModalProps) {
  const [instructions, setInstructions] = useState<CustomInstructionEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await window.readlynx?.db.listCustomInstructions();
        if (!cancelled) setInstructions(rows ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const close = () => {
    setDraft(null);
    setError(null);
    onClose();
  };

  const saveDraft = async () => {
    const name = draft?.name.trim() ?? "";
    const content = (draft?.content ?? "").trim();
    if (!draft || !name) return;
    setSaving(true);
    setError(null);
    try {
      const db = window.readlynx?.db;
      let ok: boolean | undefined;
      if (draft.id) {
        ok = await db?.updateCustomInstruction({
          id: draft.id,
          name,
          content,
          createdAt: "",
          updatedAt: "",
        });
      } else {
        ok = await db?.createCustomInstruction({
          id: crypto.randomUUID(),
          name,
          content,
          createdAt: "",
          updatedAt: "",
        });
      }
      const rows = await db?.listCustomInstructions();
      setInstructions(rows ?? []);
      if (draft.id && draft.id === selectedId) {
        onSelectedEdited?.({ id: draft.id, name, content, createdAt: "", updatedAt: "" });
      }
      if (ok) setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const removeInstruction = async (instruction: CustomInstructionEntity) => {
    if (!window.confirm(`Delete the instruction “${instruction.name}”?`)) return;
    setError(null);
    try {
      await window.readlynx?.db.deleteCustomInstruction(instruction.id);
      const rows = await window.readlynx?.db.listCustomInstructions();
      setInstructions(rows ?? []);
      if (instruction.id === selectedId) {
        onSelectedDeleted?.();
      }
      if (draft?.id === instruction.id) setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal open={open} onClose={close} title="Custom instructions" footer={null} wide>
      <p className={styles.hint}>
        Saved instruction templates that can be reused anywhere — pick one from an instruction
        dropdown, or keep “None”.
      </p>

      <div className={styles.actions}>
        <span className={styles.count}>
          {instructions.length} saved {instructions.length === 1 ? "instruction" : "instructions"}
        </span>
        <Button
          variant="secondary"
          className={styles.addButton}
          onClick={() => setDraft({ id: null, name: "", content: "" })}
          disabled={loading || saving}
        >
          <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
          Add instruction
        </Button>
      </div>

      {loading ? (
        <div className={styles.state}>
          <Loader2 size={20} strokeWidth={2} className={styles.spinner} aria-hidden="true" />
          <span>Loading instructions…</span>
        </div>
      ) : error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : (
        <ul className={styles.list}>
          {instructions.map((instruction) => (
            <li key={instruction.id} className={styles.row}>
              <div className={styles.rowInfo}>
                <span className={styles.rowName}>{instruction.name}</span>
                <span className={styles.rowContent}>{instruction.content}</span>
                {instruction.id === selectedId && (
                  <span className={styles.usedBadge}>Currently used</span>
                )}
              </div>
              <div className={styles.rowButtons}>
                <Button
                  variant="ghost"
                  className={styles.rowButton}
                  onClick={() =>
                    setDraft({
                      id: instruction.id,
                      name: instruction.name,
                      content: instruction.content,
                    })
                  }
                  disabled={saving}
                >
                  <Pencil size={13} strokeWidth={1.8} aria-hidden="true" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  className={styles.rowButton}
                  onClick={() => void removeInstruction(instruction)}
                  disabled={saving}
                >
                  <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
                  Delete
                </Button>
              </div>
            </li>
          ))}
          {instructions.length === 0 && !draft && (
            <li className={styles.empty}>
              No instructions yet — create one to reuse it anywhere.
            </li>
          )}
        </ul>
      )}

      {draft && (
        <div className={styles.form}>
          <Input
            className={styles.nameInput}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="Name, e.g. “Simple language”, “C# code examples”"
            aria-label="Instruction name"
            autoFocus
          />
          <TextArea
            className={styles.contentInput}
            rows={3}
            value={draft.content}
            onChange={(event) => setDraft({ ...draft, content: event.target.value })}
            placeholder={"The instruction text, e.g. \"Explain in simple language\""}
            aria-label="Instruction content"
          />
          <div className={styles.formButtons}>
            <Button variant="ghost" className={styles.formButton} onClick={() => setDraft(null)} disabled={saving}>
              <X size={14} strokeWidth={1.8} aria-hidden="true" />
              Cancel
            </Button>
            <Button
              variant="primary"
              className={styles.formButton}
              onClick={() => void saveDraft()}
              disabled={saving || !draft.name.trim()}
            >
              {saving ? (
                <Loader2 size={14} strokeWidth={2} className={styles.spinner} aria-hidden="true" />
              ) : (
                <Save size={14} strokeWidth={1.8} aria-hidden="true" />
              )}
              {draft.id ? "Save changes" : "Create"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}