"use strict";

/*
 * Flows a parsed Markdown block list into the active InDesign document and
 * applies the user's paragraph/character style mapping.
 *
 * Target story:
 *   - If a single text frame (or text selection) is selected, content is
 *     appended to that story.
 *   - Otherwise a new text frame is created on the active page, inset to the
 *     page margins.
 *
 * Every block is wrapped in try/catch so a single malformed construct never
 * aborts the whole import.
 */

const styles = require("./styles.js");
const { parseInline } = require("../markdown/parser.js");

function getApp() {
  return require("indesign").app;
}

function num(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/* Which character-style key wins when a run carries several flags. */
function pickCharKey(flags) {
  const f = new Set(flags);
  if (f.has("code")) return "inlineCode";
  if (f.has("link")) return "link";
  if (f.has("bold") && f.has("italic")) return "boldItalic";
  if (f.has("bold")) return "bold";
  if (f.has("italic")) return "italic";
  if (f.has("strike")) return "strikethrough";
  if (f.has("highlight")) return "highlight";
  return null;
}

function appendText(story, text) {
  story.insertionPoints.lastItem().contents = text;
}

function getTargetStory(app) {
  const doc = app.activeDocument;

  // Reuse the selected story when the selection is text-bearing.
  try {
    const sel = app.selection;
    if (sel && sel.length === 1 && sel[0] && sel[0].parentStory) {
      return { story: sel[0].parentStory, doc: doc, created: false };
    }
  } catch (e) {
    /* fall through to creating a frame */
  }

  // Otherwise create a frame inset to the active page's margins.
  const page = app.activeWindow.activePage;
  const b = page.bounds; // [y1, x1, y2, x2]
  let top = b[0];
  let left = b[1];
  let bottom = b[2];
  let right = b[3];
  try {
    const mp = page.marginPreferences;
    top = b[0] + num(mp.top);
    left = b[1] + num(mp.left);
    bottom = b[2] - num(mp.bottom);
    right = b[3] - num(mp.right);
  } catch (e) {
    /* use full page bounds */
  }

  const frame = page.textFrames.add();
  frame.geometricBounds = [top, left, bottom, right];
  return { story: frame.parentStory, doc: doc, created: true, frame: frame };
}

function tryHyperlink(doc, story, fromIndex, toIndex, url) {
  try {
    if (!/^[a-z]+:/i.test(url)) {
      return; // only wire up real URLs (http:, mailto:, …)
    }
    const range = story.characters.itemByRange(fromIndex, toIndex);
    const source = doc.hyperlinkTextSources.add(range);
    const dest = doc.hyperlinkURLDestinations.add(url);
    doc.hyperlinks.add(source, dest);
  } catch (e) {
    /* hyperlink creation is best-effort */
  }
}

/*
 * Append one paragraph built from inline runs, apply its paragraph style, then
 * apply character styles + hyperlinks to each inline run.
 * `prefix` is optional literal text inserted before the runs (list markers).
 */
function appendParagraph(ctx, runs, styleKey, prefix) {
  const story = ctx.story;
  const doc = ctx.doc;
  const mapping = ctx.mapping;

  let plain = runs.map((r) => r.text).join("");
  if (prefix) {
    plain = prefix + plain;
  }

  const start = story.characters.length;
  appendText(story, plain + "\r");

  const pStyle = styles.resolveParagraphStyle(doc, mapping.paragraph[styleKey]);
  const len = plain.length;

  if (len > 0) {
    if (pStyle) {
      try {
        story.characters.itemByRange(start, start + len - 1).appliedParagraphStyle = pStyle;
      } catch (e) {
        /* ignore */
      }
    }

    let cursor = start + (prefix ? prefix.length : 0);
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r];
      const rlen = run.text.length;
      if (rlen > 0) {
        const key = pickCharKey(run.flags);
        if (key) {
          const cStyle = styles.resolveCharacterStyle(doc, mapping.character[key]);
          if (cStyle) {
            try {
              story.characters.itemByRange(cursor, cursor + rlen - 1).appliedCharacterStyle = cStyle;
            } catch (e) {
              /* ignore */
            }
          }
        }
        if (run.url) {
          tryHyperlink(doc, story, cursor, cursor + rlen - 1, run.url);
        }
      }
      cursor += rlen;
    }
  } else if (pStyle) {
    // Empty paragraph – still style the lone paragraph mark.
    try {
      story.characters.itemByRange(start, start).appliedParagraphStyle = pStyle;
    } catch (e) {
      /* ignore */
    }
  }
}

function listMarker(kind, block, ctx) {
  if (ctx.options.includeListMarkers === false) {
    return "";
  }
  const level = Math.max(0, Math.round((block.indent || 0) / 2));
  const indent = level > 0 ? "\t".repeat(level) : "";
  if (kind === "ul") return indent + "•\t";
  if (kind === "ol") return indent + (block.number || 1) + ".\t";
  if (kind === "task") return indent + (block.checked ? "☑" : "☐") + "\t";
  return "";
}

function insertRule(ctx) {
  const story = ctx.story;
  const doc = ctx.doc;
  const styleName = ctx.mapping.paragraph.horizontalRule;
  const style = styles.resolveParagraphStyle(doc, styleName);
  const start = story.characters.length;
  if (style) {
    appendText(story, "\r");
    try {
      story.characters.itemByRange(start, start).appliedParagraphStyle = style;
    } catch (e) {
      /* ignore */
    }
  } else {
    appendText(story, "————————\r");
  }
}

function stripInline(s) {
  return parseInline(s)
    .map((r) => r.text)
    .join("");
}

function insertTable(ctx, block) {
  const story = ctx.story;
  const doc = ctx.doc;
  const mapping = ctx.mapping;

  const allRows = [block.header].concat(block.rows);
  const cols = block.header.length;
  if (!cols) {
    return;
  }

  appendText(story, "\r");
  const ip = story.insertionPoints.lastItem();
  const table = ip.tables.add();

  try {
    table.columnCount = cols;
    table.headerRowCount = 1;
    table.bodyRowCount = block.rows.length;
  } catch (e) {
    /* table sizing is best-effort */
  }

  for (let r = 0; r < allRows.length; r++) {
    const row = allRows[r] || [];
    for (let c = 0; c < cols; c++) {
      const cellText = row[c] !== undefined ? stripInline(row[c]) : "";
      try {
        const cell = table.rows.item(r).cells.item(c);
        cell.contents = cellText;
        const key = r === 0 ? "tableHeader" : "tableCell";
        const styleName = mapping.paragraph[key] || mapping.paragraph.tableCell;
        const pStyle = styles.resolveParagraphStyle(doc, styleName);
        if (pStyle) {
          cell.texts.item(0).appliedParagraphStyle = pStyle;
        }
      } catch (e) {
        /* skip individual cell on error */
      }
    }
  }
}

function insertImage(ctx, block) {
  // v1: render the alt text (or URL) as a styled caption paragraph.
  const alt = block.alt || block.url || "[image]";
  appendParagraph(ctx, [{ text: alt, flags: [], url: null }], "image");
}

function applyToDocument(blocks, mapping, options) {
  const app = getApp();
  if (!app.documents.length) {
    throw new Error("Open or create an InDesign document first.");
  }

  const target = getTargetStory(app);
  const ctx = {
    story: target.story,
    doc: target.doc,
    mapping: mapping,
    options: options || {}
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    try {
      switch (block.type) {
        case "heading":
        case "paragraph":
        case "blockquote":
          appendParagraph(ctx, block.runs, block.styleKey);
          break;
        case "codeBlock":
          if (block.lines.length === 0) {
            appendParagraph(ctx, [{ text: "", flags: [], url: null }], "codeBlock");
          } else {
            for (let l = 0; l < block.lines.length; l++) {
              appendParagraph(ctx, [{ text: block.lines[l], flags: [], url: null }], "codeBlock");
            }
          }
          break;
        case "unorderedList":
          appendParagraph(ctx, block.runs, "unorderedList", listMarker("ul", block, ctx));
          break;
        case "orderedList":
          appendParagraph(ctx, block.runs, "orderedList", listMarker("ol", block, ctx));
          break;
        case "taskList":
          appendParagraph(ctx, block.runs, "taskList", listMarker("task", block, ctx));
          break;
        case "horizontalRule":
          insertRule(ctx);
          break;
        case "table":
          insertTable(ctx, block);
          break;
        case "image":
          insertImage(ctx, block);
          break;
        default:
          break;
      }
    } catch (e) {
      /* keep importing the rest of the document */
    }
  }

  return { created: target.created, blocks: blocks.length };
}

module.exports = { applyToDocument: applyToDocument, pickCharKey: pickCharKey };
