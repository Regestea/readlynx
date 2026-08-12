import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { CodeNode } from "@lexical/code";

import "prismjs";
import "prismjs/components/prism-json";
import "prismjs/components/prism-latex";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-docker";
import "prismjs/components/prism-git";
import "prismjs/components/prism-graphql";
import "prismjs/components/prism-http";
import "prismjs/components/prism-ini";
import "prismjs/components/prism-properties";
import "prismjs/components/prism-regex";
import "prismjs/components/prism-shell-session";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-xml-doc";

const CODE_LANGUAGE_ALIASES: Record<string, string> = {
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  yml: "yaml",
  json5: "json",
  tex: "latex",
  dockerfile: "docker",
};

function $normalizeCodeLanguage(node: CodeNode): void {
  const language = node.getLanguage();
  if (typeof language !== "string") return;
  const mapped = CODE_LANGUAGE_ALIASES[language.toLowerCase()];
  if (mapped && mapped !== language) node.setLanguage(mapped);
}

/**
 * Loads the Prism grammars that `@lexical/code` does not preload and keeps the
 * code block language normalized so fenced blocks from AI replies or
 * typed/pasted Markdown are syntax-highlighted in the editor.
 */
export function ExtendedCodeHighlightingPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => editor.registerNodeTransform(CodeNode, $normalizeCodeLanguage), [editor]);

  return null;
}