import { createContext, useContext } from "react";
import { EMPTY_TOOLBAR_STATE, type EditorAPI, type ToolbarState } from "./types";

export const EditorApiContext = createContext<EditorAPI | null>(null);
export const ToolbarStateContext = createContext<ToolbarState>(EMPTY_TOOLBAR_STATE);

export function useEditorAPI(): EditorAPI {
  const api = useContext(EditorApiContext);
  if (!api) throw new Error("useEditorAPI must be used inside <EditorProvider>");
  return api;
}

export function useToolbarState(): ToolbarState {
  return useContext(ToolbarStateContext);
}
