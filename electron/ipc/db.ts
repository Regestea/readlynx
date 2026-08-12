import { ipcMain } from "electron";
import type { DbWorkerClient } from "../db/client.ts";
import type { AiModel } from "../../src/infrastructure/db/entities/AiModel.ts";
import type { SaveDocumentPayload, UpdateBookPayload } from "../../src/infrastructure/db/entities/types.ts";
import type { ReadingStateInput } from "../../src/infrastructure/db/repositories/ReadingStateRepository.ts";

export function registerDbIpc(db: DbWorkerClient) {
  ipcMain.handle("db:create-book", () => db.createBook());

  ipcMain.handle("db:create-translated-book", (_event, payload) =>
    db.createTranslatedBook(payload),
  );

  ipcMain.handle("db:create-reading-book", (_event, payload) =>
    db.createReadingBook(payload),
  );

  ipcMain.handle("db:save-document", (_event, payload: SaveDocumentPayload) =>
    db.saveDocument(payload),
  );

  ipcMain.handle("db:list-books", () => db.listBooks());

  ipcMain.handle("db:get-book", (_event, bookId: string) => db.getBook(bookId));

  ipcMain.handle("db:delete-book", (_event, bookId: string) => db.deleteBook(bookId));

  ipcMain.handle("db:update-book", (_event, payload: UpdateBookPayload) =>
    db.updateBook(payload),
  );

  ipcMain.handle("db:get-app-settings", () => db.getAppSettings());

  ipcMain.handle("db:update-app-settings", (_event, theme: string) => db.updateAppSettings(theme));

  ipcMain.handle("db:ai-models-list", () => db.listAiModels());

  ipcMain.handle("db:ai-model-create", (_event, model: AiModel) => db.createAiModel(model));

  ipcMain.handle("db:ai-model-update", (_event, model: AiModel) => db.updateAiModel(model));

  ipcMain.handle("db:ai-model-delete", (_event, id: string) => db.deleteAiModel(id));

  ipcMain.handle("db:ai-model-set-default", (_event, id: string) => db.setDefaultAiModel(id));

  ipcMain.handle("db:reading-state-get", (_event, bookId: string) =>
    db.getReadingState(bookId),
  );

  ipcMain.handle(
    "db:reading-state-update",
    (_event, payload: { bookId: string } & ReadingStateInput) => {
      const { bookId, ...state } = payload;
      return db.updateReadingState(bookId, state);
    },
  );

  ipcMain.handle("db:translation-get", (_event, options) => db.getTranslations(options));

  ipcMain.handle("db:translation-put", (_event, translation) => db.putTranslation(translation));

  ipcMain.handle("db:translation-delete", (_event, options) =>
    db.deleteTranslations(options),
  );

  ipcMain.handle("db:custom-instructions-list", () => db.listCustomInstructions());

  ipcMain.handle("db:custom-instruction-create", (_event, instruction) =>
    db.createCustomInstruction(instruction),
  );

  ipcMain.handle("db:custom-instruction-update", (_event, instruction) =>
    db.updateCustomInstruction(instruction),
  );

  ipcMain.handle("db:custom-instruction-delete", (_event, id: string) =>
    db.deleteCustomInstruction(id),
  );
}
