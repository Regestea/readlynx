import type { EditorThemeClasses } from "lexical";
import styles from "./MarkdownEditor.module.css";

export function createEditorTheme(): EditorThemeClasses {
  return {
    paragraph: styles.editorParagraph,
    heading: {
      h1: styles.heading1,
      h2: styles.heading2,
      h3: styles.heading3,
      h4: styles.heading4,
      h5: styles.heading5,
      h6: styles.heading6,
    },
    quote: styles.editorQuote,
    code: styles.editorCode,
    codeHighlight: { default: styles.codeHighlight },
    text: {
      bold: styles.textBold,
      italic: styles.textItalic,
      underline: styles.textUnderline,
      strikethrough: styles.textStrikethrough,
      highlight: styles.textHighlight,
      superscript: styles.textSuperscript,
      subscript: styles.textSubscript,
      code: styles.textCode,
    },
    list: {
      ul: styles.listUl,
      ol: styles.listOl,
      checklist: styles.listUl,
      listitem: styles.listItem,
      listitemChecked: styles.listItemChecked,
      listitemUnchecked: styles.listItemUnchecked,
      nested: {
        list: styles.nestedList,
        listitem: styles.nestedListItem,
      },
    },
    link: styles.editorLink,
    table: styles.table,
    tableRow: styles.tableRow,
    tableCell: styles.tableCell,
    tableCellHeader: styles.tableCellHeader,
    tableCellPrimary: styles.tableCellPrimary,
    tableCellSecondary: styles.tableCellSecondary,
    hr: styles.editorHr,
  };
}
