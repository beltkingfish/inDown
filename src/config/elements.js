"use strict";

/*
 * The set of Markdown constructs that inDown can scope to InDesign styles.
 *
 * `key`   – stable identifier used in the saved mapping and by the importer.
 * `label` – human-readable label shown in the settings window.
 *
 * Paragraph-level elements map to paragraph styles; character-level (inline)
 * elements map to character styles.
 */

const PARAGRAPH_ELEMENTS = [
  { key: "h1", label: "Heading 1  ( # )" },
  { key: "h2", label: "Heading 2  ( ## )" },
  { key: "h3", label: "Heading 3  ( ### )" },
  { key: "h4", label: "Heading 4  ( #### )" },
  { key: "h5", label: "Heading 5  ( ##### )" },
  { key: "h6", label: "Heading 6  ( ###### )" },
  { key: "paragraph", label: "Body / paragraph" },
  { key: "blockquote", label: "Blockquote  ( > )" },
  { key: "codeBlock", label: "Code block  ( ``` )" },
  { key: "unorderedList", label: "Bulleted list  ( -, *, + )" },
  { key: "orderedList", label: "Numbered list  ( 1. )" },
  { key: "taskList", label: "Task list  ( - [ ] )" },
  { key: "horizontalRule", label: "Horizontal rule  ( --- )" },
  { key: "tableHeader", label: "Table header cell" },
  { key: "tableCell", label: "Table body cell" },
  { key: "image", label: "Image / caption" }
];

const CHARACTER_ELEMENTS = [
  { key: "bold", label: "Bold  ( ** )" },
  { key: "italic", label: "Italic  ( * )" },
  { key: "boldItalic", label: "Bold + Italic  ( *** )" },
  { key: "inlineCode", label: "Inline code  ( ` )" },
  { key: "link", label: "Link  ( [ ]( ) )" },
  { key: "strikethrough", label: "Strikethrough  ( ~~ )" },
  { key: "highlight", label: "Highlight  ( == )" }
];

module.exports = { PARAGRAPH_ELEMENTS, CHARACTER_ELEMENTS };
