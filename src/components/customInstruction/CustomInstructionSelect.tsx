import { useEffect, useState } from "react";
import type { CustomInstructionEntity } from "../../infrastructure/db/entities/CustomInstruction.ts";
import { Select } from "../ui/Select/Select";
import { CustomInstructionsModal } from "./CustomInstructionsModal.tsx";

/** "Modify…" entry at the bottom of the instruction select: opens the
 *  manager modal instead of picking an instruction. */
const MANAGE_INSTRUCTIONS = "__manage__";

interface CustomInstructionSelectProps {
  /** Id of the currently chosen instruction ("" = none). */
  value: string;
  onChange: (id: string) => void;
  /** Called with the picked instruction when the user selects a saved one,
   *  or with null when they pick "No instruction" — lets callers fill their
   *  own editable instruction text. */
  onPicked?: (instruction: CustomInstructionEntity | null) => void;
  /** Called with the updated instruction after the currently selected one is
   *  edited inside the manager (its id does not change, so the caller's
   *  id-keyed effect would not re-run). */
  onInstructionEdited?: (instruction: CustomInstructionEntity) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  ariaLabel?: string;
  title?: string;
}

/** Shared "Custom instruction" dropdown: the user's saved instruction
 *  templates plus a "Modify…" entry that opens the manager modal. Reused by
 *  the reading page's translation toolbar and the create page's AI vision
 *  extraction panel. */
export function CustomInstructionSelect({
  value,
  onChange,
  onPicked,
  onInstructionEdited,
  disabled = false,
  compact = false,
  className = "",
  ariaLabel = "Custom instruction",
  title = "Custom instruction",
}: CustomInstructionSelectProps) {
  const [manageOpen, setManageOpen] = useState(false);
  const [instructions, setInstructions] = useState<CustomInstructionEntity[]>([]);

  /** Saved instruction list: loaded once on mount and refreshed every time
   *  the manager modal closes (it may have created/edited/deleted rows). */
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await window.readlynx?.db.listCustomInstructions();
        if (!cancelled) setInstructions(rows ?? []);
      } catch {
        // keep whatever was loaded before
      }
    };
    if (!manageOpen) void load();
    return () => {
      cancelled = true;
    };
  }, [manageOpen]);

  const handleInstructionChange = (next: string) => {
    if (next === MANAGE_INSTRUCTIONS) {
      setManageOpen(true);
      return;
    }
    if (next === "") {
      onChange("");
      onPicked?.(null);
      return;
    }
    const found = instructions.find((instruction) => instruction.id === next);
    if (found) {
      onChange(found.id);
      onPicked?.(found);
    }
  };

  return (
    <>
      <Select
        compact={compact}
        className={className}
        value={value}
        onChange={(event) => handleInstructionChange(event.target.value)}
        options={[{ value: "", label: "No instruction" }]}
        groups={[
          {
            label: "Saved",
            options: instructions.map((instruction) => ({
              value: instruction.id,
              label: instruction.name,
            })),
          },
          {
            label: "Manage",
            options: [{ value: MANAGE_INSTRUCTIONS, label: "Modify…" }],
          },
        ]}
        disabled={disabled}
        aria-label={ariaLabel}
        title={title}
      />

      <CustomInstructionsModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        selectedId={value}
        onSelectedEdited={(instruction) => {
          onInstructionEdited?.(instruction);
          if (instruction.id === value) onPicked?.(instruction);
        }}
        onSelectedDeleted={() => {
          onChange("");
          onPicked?.(null);
        }}
      />
    </>
  );
}