import type Database from "better-sqlite3";
import type { AiModel } from "../entities/index.ts";

interface AiModelRow extends Omit<AiModel, "IsDefault"> {
  IsDefault: number;
}

function toModel(row: AiModelRow): AiModel {
  return { ...row, IsDefault: row.IsDefault === 1 };
}

const SELECT_COLUMNS = "Id, DisplayName, URL, ModelName, APIKey, Provider, IsDefault";

/** Row store for the `AiModels` table. API keys never leave the local
 *  database; the renderer uses them directly when calling a provider. */
export class AiModelRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  list(): AiModel[] {
    return (
      this.db
        .prepare(
          `SELECT ${SELECT_COLUMNS} FROM AiModels ORDER BY DisplayName, ModelName`,
        )
        .all() as AiModelRow[]
    ).map(toModel);
  }

  findById(id: string): AiModel | undefined {
    const row = this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM AiModels WHERE Id = ?`)
      .get(id) as AiModelRow | undefined;
    return row ? toModel(row) : undefined;
  }

  /** The default model, or the first configured one when none is flagged. */
  findDefault(): AiModel | undefined {
    const models = this.list();
    return models.find((model) => model.IsDefault) ?? models[0];
  }

  insert(model: AiModel): void {
    this.db
      .prepare(
        `INSERT INTO AiModels (Id, DisplayName, URL, ModelName, APIKey, Provider, IsDefault)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        model.Id,
        model.DisplayName,
        model.URL,
        model.ModelName,
        model.APIKey,
        model.Provider,
        model.IsDefault ? 1 : 0,
      );
  }

  update(model: AiModel): void {
    this.db
      .prepare(
        `UPDATE AiModels
         SET DisplayName = ?, URL = ?, ModelName = ?, APIKey = ?, Provider = ?, IsDefault = ?
         WHERE Id = ?`,
      )
      .run(
        model.DisplayName,
        model.URL,
        model.ModelName,
        model.APIKey,
        model.Provider,
        model.IsDefault ? 1 : 0,
        model.Id,
      );
  }

  /** Marks one model as the default, clearing the flag on all others. */
  setDefault(id: string): void {
    this.db.transaction(() => {
      this.db.prepare("UPDATE AiModels SET IsDefault = 0").run();
      this.db.prepare("UPDATE AiModels SET IsDefault = 1 WHERE Id = ?").run(id);
    })();
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM AiModels WHERE Id = ?").run(id);
  }
}