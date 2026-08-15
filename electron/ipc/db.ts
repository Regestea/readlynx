import { ipcMain } from "electron";
import type { DbWorkerClient } from "../db/client.ts";
import type { AiModel } from "../../src/infrastructure/db/entities/AiModel.ts";
import type { SaveDocumentPayload, UpdateBookPayload } from "../../src/infrastructure/db/entities/types.ts";
import type { ReadingStateInput } from "../../src/infrastructure/db/repositories/ReadingStateRepository.ts";
import type { AppSettingsInput } from "../../src/infrastructure/db/repositories/AppSettingsRepository.ts";

/** The listener type `ipcMain.handle` accepts. */
type IpcHandler = Parameters<typeof ipcMain.handle>[1];

/** Registers (or re-registers) one IPC channel, replacing any previous
 *  handler — so the db layer can be torn down and re-registered after a
 *  restore swaps the database file. */
function handle(channel: string, listener: IpcHandler) {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, listener);
}

export function registerDbIpc(db: DbWorkerClient) {
  handle("db:create-book", () => db.createBook());

  handle("db:create-translated-book", (_event, payload) =>
    db.createTranslatedBook(payload),
  );

  handle("db:create-reading-book", (_event, payload) =>
    db.createReadingBook(payload),
  );

  handle("db:save-document", (_event, payload: SaveDocumentPayload) =>
    db.saveDocument(payload),
  );

  handle("db:list-books", () => db.listBooks());

  handle("db:get-book", (_event, bookId: string) => db.getBook(bookId));

  handle("db:delete-book", (_event, bookId: string) => db.deleteBook(bookId));

  handle("db:update-book", (_event, payload: UpdateBookPayload) =>
    db.updateBook(payload),
  );

  handle("db:get-app-settings", () => db.getAppSettings());

  handle("db:update-app-settings", (_event, patch: AppSettingsInput) => db.updateAppSettings(patch));

  handle("db:ai-models-list", () => db.listAiModels());

  handle("db:ai-model-create", (_event, model: AiModel) => db.createAiModel(model));

  handle("db:ai-model-update", (_event, model: AiModel) => db.updateAiModel(model));

  handle("db:ai-model-delete", (_event, id: string) => db.deleteAiModel(id));

  handle("db:ai-model-set-default", (_event, id: string) => db.setDefaultAiModel(id));

  handle("db:reading-state-get", (_event, bookId: string) =>
    db.getReadingState(bookId),
  );

  handle(
    "db:reading-state-update",
    (_event, payload: { bookId: string } & ReadingStateInput) => {
      const { bookId, ...state } = payload;
      return db.updateReadingState(bookId, state);
    },
  );

  handle("db:reading-state-mark-opened", (_event, bookId: string) =>
    db.markReadingStateOpened(bookId),
  );

  handle("db:reading-state-finalize", (_event, bookId: string) =>
    db.finalizeReadingState(bookId),
  );

  handle(
    "db:reading-state-add-time",
    (_event, payload: { bookId: string; startedAt: number; endedAt: number }) =>
      db.appendReadingEvent(payload.bookId, payload.startedAt, payload.endedAt),
  );

  handle("db:reading-progress-list", () => db.listReadingProgress());

  handle("db:reading-events-week", () => db.getWeekReadingEvents());

  handle("db:reading-goal-get", () => db.getDailyGoal());

  handle("db:reading-goal-set", (_event, payload: { minutes: number }) =>
    db.setDailyGoal(payload.minutes),
  );

  handle("db:reader-settings-get", (_event, payload) =>
    db.getReaderSettings(payload.bookId, payload.viewer),
  );

  handle("db:reader-settings-update", (_event, payload) =>
    db.updateReaderSettings(payload.bookId, payload.viewer, payload),
  );

  handle("db:translation-get", (_event, options) => db.getTranslations(options));

  handle("db:translation-put", (_event, translation) => db.putTranslation(translation));

  handle("db:translation-delete", (_event, options) =>
    db.deleteTranslations(options),
  );

  handle("db:custom-instructions-list", () => db.listCustomInstructions());

  handle("db:custom-instruction-create", (_event, instruction) =>
    db.createCustomInstruction(instruction),
  );

  handle("db:custom-instruction-update", (_event, instruction) =>
    db.updateCustomInstruction(instruction),
  );

  handle("db:custom-instruction-delete", (_event, id: string) =>
    db.deleteCustomInstruction(id),
  );
}
