/** Row of the `CustomInstructions` table: prompts the user saved for reuse
 *  across books (shared by every translation pipeline). */
export interface CustomInstructionEntity {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}