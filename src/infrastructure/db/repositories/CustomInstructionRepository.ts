import type Database from "better-sqlite3";
import type { CustomInstructionEntity } from "../entities/index.ts";

const SELECT_COLUMNS = "id, name, content, createdAt, updatedAt";

/** Row store for the `CustomInstructions` table (user-saved translation
 *  prompts, shared across all books). */
export class CustomInstructionRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  list(): CustomInstructionEntity[] {
    return this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM CustomInstructions ORDER BY name, createdAt`)
      .all() as CustomInstructionEntity[];
  }

  insert(entity: CustomInstructionEntity): void {
    this.db
      .prepare(
        `INSERT INTO CustomInstructions (id, name, content, createdAt, updatedAt)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(entity.id, entity.name, entity.content);
  }

  update(entity: CustomInstructionEntity): void {
    this.db
      .prepare(
        `UPDATE CustomInstructions
         SET name = ?, content = ?, updatedAt = datetime('now')
         WHERE id = ?`,
      )
      .run(entity.name, entity.content, entity.id);
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM CustomInstructions WHERE id = ?").run(id);
  }
}