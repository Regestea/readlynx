import type Database from "better-sqlite3";
import type { AiModel } from "../entities/index.ts";

/** Row store for the `AiModels` table. API keys never leave the local
 *  database; the renderer uses them directly when calling a provider. */
export class AiModelRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  list(): AiModel[] {
    return this.db
      .prepare(
        "SELECT Id, DisplayName, URL, ModelName, APIKey, Provider FROM AiModels ORDER BY DisplayName, ModelName",
      )
      .all() as AiModel[];
  }

  findById(id: string): AiModel | undefined {
    return this.db
      .prepare("SELECT Id, DisplayName, URL, ModelName, APIKey, Provider FROM AiModels WHERE Id = ?")
      .get(id) as AiModel | undefined;
  }

  insert(model: AiModel): void {
    this.db
      .prepare(
        "INSERT INTO AiModels (Id, DisplayName, URL, ModelName, APIKey, Provider) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(model.Id, model.DisplayName, model.URL, model.ModelName, model.APIKey, model.Provider);
  }

  update(model: AiModel): void {
    this.db
      .prepare(
        "UPDATE AiModels SET DisplayName = ?, URL = ?, ModelName = ?, APIKey = ?, Provider = ? WHERE Id = ?",
      )
      .run(model.DisplayName, model.URL, model.ModelName, model.APIKey, model.Provider, model.Id);
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM AiModels WHERE Id = ?").run(id);
  }
}