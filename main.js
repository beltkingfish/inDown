"use strict";

/*
 * inDown — bring Markdown into InDesign, mapped to your styles.
 *
 * Single-file plugin entry. Everything lives here (parser, style mapping,
 * importer, panel UI) with no cross-file requires, because UXP loads this as
 * the panel's root script and local module resolution is unreliable.
 *
 * The built-in `uxp` / `indesign` modules are required lazily inside the
 * functions that use them, so this file can also be required in plain Node
 * for the parser unit tests.
 */

/* ===================================================================== *
 * Markdown parser  (no host dependency)
 * ===================================================================== */

const FLAG = {
  BOLD: "bold",
  ITALIC: "italic",
  CODE: "code",
  STRIKE: "strike",
  HIGHLIGHT: "highlight",
  LINK: "link"
};

function isWordChar(ch) {
  return !!ch && /[A-Za-z0-9]/.test(ch);
}

function combine(ctx, addFlag, url) {
  const flags = new Set(ctx.flags);
  if (addFlag) {
    flags.add(addFlag);
  }
  return { flags: flags, url: url || ctx.url || null };
}

function parseInline(text) {
  const runs = [];

  function emit(str, ctx) {
    if (str && str.length) {
      runs.push({ text: str, flags: Array.from(ctx.flags), url: ctx.url || null });
    }
  }

  function walk(str, ctx) {
    let i = 0;
    let local = "";
    const flushLocal = () => {
      if (local.length) {
        emit(local, ctx);
        local = "";
      }
    };

    while (i < str.length) {
      const rest = str.slice(i);
      const prev = i > 0 ? str[i - 1] : "";
      let m;

      if ((m = /^\\([\\`*_{}\[\]()#+\-.!~>|=])/.exec(rest))) {
        local += m[1];
        i += m[0].length;
        continue;
      }
      if ((m = /^(`+)([\s\S]*?)\1(?!`)/.exec(rest))) {
        flushLocal();
        emit(m[2].replace(/^ | $/g, ""), combine(ctx, FLAG.CODE));
        i += m[0].length;
        continue;
      }
      if ((m = /^!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/.exec(rest))) {
        flushLocal();
        emit(m[1] || m[2], combine(ctx, null));
        i += m[0].length;
        continue;
      }
      if ((m = /^\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/.exec(rest))) {
        flushLocal();
        walk(m[1], combine(ctx, FLAG.LINK, m[2]));
        i += m[0].length;
        continue;
      }
      if ((m = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/.exec(rest))) {
        flushLocal();
        emit(m[1], combine(ctx, FLAG.LINK, m[1]));
        i += m[0].length;
        continue;
      }
      if ((m = /^\*\*\*([\s\S]+?)\*\*\*/.exec(rest)) || (m = /^___([\s\S]+?)___/.exec(rest))) {
        flushLocal();
        walk(m[1], combine(combine(ctx, FLAG.BOLD), FLAG.ITALIC));
        i += m[0].length;
        continue;
      }
      if ((m = /^\*\*([\s\S]+?)\*\*/.exec(rest)) || (m = /^__([\s\S]+?)__/.exec(rest))) {
        flushLocal();
        walk(m[1], combine(ctx, FLAG.BOLD));
        i += m[0].length;
        continue;
      }
      if ((m = /^~~([\s\S]+?)~~/.exec(rest))) {
        flushLocal();
        walk(m[1], combine(ctx, FLAG.STRIKE));
        i += m[0].length;
        continue;
      }
      if ((m = /^==([\s\S]+?)==/.exec(rest))) {
        flushLocal();
        walk(m[1], combine(ctx, FLAG.HIGHLIGHT));
        i += m[0].length;
        continue;
      }
      if ((m = /^\*([^\s*][\s\S]*?)\*/.exec(rest))) {
        flushLocal();
        walk(m[1], combine(ctx, FLAG.ITALIC));
        i += m[0].length;
        continue;
      }
      if (!isWordChar(prev) && (m = /^_([^\s_][\s\S]*?)_(?![A-Za-z0-9])/.exec(rest))) {
        flushLocal();
        walk(m[1], combine(ctx, FLAG.ITALIC));
        i += m[0].length;
        continue;
      }

      local += str[i];
      i += 1;
    }

    flushLocal();
  }

  walk(String(text == null ? "" : text), { flags: new Set(), url: null });
  return runs;
}

function splitRow(line) {
  const s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cur = "";
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === "\\" && s[k + 1] === "|") {
      cur += "|";
      k += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function parseTable(lines, start) {
  const header = splitRow(lines[start]);
  const delim = splitRow(lines[start + 1]);
  const aligns = delim.map((c) => {
    const t = c.trim();
    const l = t.indexOf(":") === 0;
    const r = t.lastIndexOf(":") === t.length - 1 && t.length > 0;
    if (l && r) return "center";
    if (r) return "right";
    if (l) return "left";
    return null;
  });

  let i = start + 2;
  const rows = [];
  while (i < lines.length && lines[i].indexOf("|") >= 0 && !/^\s*$/.test(lines[i])) {
    rows.push(splitRow(lines[i]));
    i += 1;
  }

  return {
    block: { type: "table", styleKey: "tableCell", header: header, aligns: aligns, rows: rows },
    next: i
  };
}

const RE = {
  fence: /^\s{0,3}(```|~~~)(.*)$/,
  heading: /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/,
  hr: /^\s{0,3}([-*_])\s*(\1\s*){2,}$/,
  blockquote: /^\s{0,3}>/,
  ul: /^(\s*)([-*+])\s+(.*)$/,
  ol: /^(\s*)(\d+)[.)]\s+(.*)$/,
  task: /^\[([ xX])\]\s+(.*)$/,
  tableDelim: /^\s{0,3}\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/,
  image: /^\s*!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)\s*$/
};

function isBlank(s) {
  return /^\s*$/.test(s);
}

function looksLikeTable(line, next) {
  if (line.indexOf("|") < 0 || next == null || !RE.tableDelim.test(next)) {
    return false;
  }
  // GFM: the delimiter row must match the header row in number of cells.
  // Without this, "text | text" followed by a plain "---" is mis-read as a
  // one-column table instead of a paragraph + rule/setext heading.
  return splitRow(next).length === splitRow(line).length;
}

function isBlockStart(line, next) {
  if (line == null) {
    return false;
  }
  return (
    RE.heading.test(line) ||
    RE.fence.test(line) ||
    RE.blockquote.test(line) ||
    /^\s*([-*+])\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    RE.hr.test(line) ||
    looksLikeTable(line, next)
  );
}

function parseMarkdown(src) {
  const text = String(src == null ? "" : src).replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      i += 1;
      continue;
    }

    let m;

    if ((m = RE.fence.exec(line))) {
      const fence = m[1];
      const lang = (m[2] || "").trim();
      i += 1;
      const code = [];
      const closeRe = new RegExp("^\\s{0,3}" + fence);
      while (i < lines.length && !closeRe.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) {
        i += 1;
      }
      blocks.push({ type: "codeBlock", styleKey: "codeBlock", lang: lang, lines: code });
      continue;
    }

    if ((m = RE.heading.exec(line))) {
      const level = m[1].length;
      blocks.push({ type: "heading", styleKey: "h" + level, level: level, runs: parseInline(m[2]) });
      i += 1;
      continue;
    }

    if (RE.hr.test(line)) {
      blocks.push({ type: "horizontalRule", styleKey: "horizontalRule" });
      i += 1;
      continue;
    }

    if (looksLikeTable(line, lines[i + 1])) {
      const tbl = parseTable(lines, i);
      blocks.push(tbl.block);
      i = tbl.next;
      continue;
    }

    if (RE.blockquote.test(line)) {
      while (i < lines.length && RE.blockquote.test(lines[i])) {
        const content = lines[i].replace(/^\s{0,3}>\s?/, "");
        if (!isBlank(content)) {
          blocks.push({ type: "blockquote", styleKey: "blockquote", runs: parseInline(content) });
        }
        i += 1;
      }
      continue;
    }

    if (/^\s*([-*+])\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      while (i < lines.length) {
        const l = lines[i];
        let mm;
        if ((mm = RE.ul.exec(l))) {
          const indent = mm[1].length;
          const content = mm[3];
          let tm;
          if ((tm = RE.task.exec(content))) {
            blocks.push({
              type: "taskList",
              styleKey: "taskList",
              checked: /[xX]/.test(tm[1]),
              indent: indent,
              runs: parseInline(tm[2])
            });
          } else {
            blocks.push({
              type: "unorderedList",
              styleKey: "unorderedList",
              indent: indent,
              runs: parseInline(content)
            });
          }
          i += 1;
          continue;
        }
        if ((mm = RE.ol.exec(l))) {
          blocks.push({
            type: "orderedList",
            styleKey: "orderedList",
            indent: mm[1].length,
            number: parseInt(mm[2], 10),
            runs: parseInline(mm[3])
          });
          i += 1;
          continue;
        }
        break;
      }
      continue;
    }

    if ((m = RE.image.exec(line))) {
      blocks.push({ type: "image", styleKey: "image", alt: m[1], url: m[2] });
      i += 1;
      continue;
    }

    const para = [];
    let setext = 0;
    while (i < lines.length && !isBlank(lines[i]) && !isBlockStart(lines[i], lines[i + 1])) {
      para.push(lines[i]);
      i += 1;
      // Setext heading: a paragraph line immediately underlined with = (h1)
      // or - (h2). Checked inside the loop because "---" alone would
      // otherwise terminate the paragraph as a horizontal rule.
      const nl = lines[i];
      if (nl != null) {
        if (/^\s{0,3}=+\s*$/.test(nl)) {
          setext = 1;
          i += 1;
          break;
        }
        if (/^\s{0,3}-+\s*$/.test(nl)) {
          setext = 2;
          i += 1;
          break;
        }
      }
    }
    const joined = para.join(" ").replace(/\s+/g, " ").trim();
    if (setext) {
      blocks.push({ type: "heading", styleKey: "h" + setext, level: setext, runs: parseInline(joined) });
    } else {
      blocks.push({ type: "paragraph", styleKey: "paragraph", runs: parseInline(joined) });
    }
  }

  return blocks;
}

/* ===================================================================== *
 * Mappable elements
 * ===================================================================== */

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

/* ===================================================================== *
 * Style mapping persistence
 * ===================================================================== */

const STORAGE_KEY = "indown.styleMapping.v1";
let mappingMemory = null;

function getStore() {
  try {
    if (typeof localStorage !== "undefined" && localStorage) {
      return localStorage;
    }
  } catch (e) {
    /* not available */
  }
  return null;
}

function emptyMapping() {
  const m = { paragraph: {}, character: {} };
  PARAGRAPH_ELEMENTS.forEach((e) => {
    m.paragraph[e.key] = "";
  });
  CHARACTER_ELEMENTS.forEach((e) => {
    m.character[e.key] = "";
  });
  return m;
}

function loadMapping() {
  const base = emptyMapping();
  let raw = null;
  const store = getStore();
  try {
    raw = store ? store.getItem(STORAGE_KEY) : mappingMemory;
  } catch (e) {
    raw = mappingMemory;
  }
  if (!raw) {
    return base;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.paragraph) Object.assign(base.paragraph, parsed.paragraph);
    if (parsed && parsed.character) Object.assign(base.character, parsed.character);
  } catch (e) {
    /* ignore corrupt value */
  }
  return base;
}

function saveMapping(mapping) {
  const raw = JSON.stringify(mapping);
  const store = getStore();
  try {
    if (store) store.setItem(STORAGE_KEY, raw);
    else mappingMemory = raw;
  } catch (e) {
    mappingMemory = raw;
  }
}

/* ===================================================================== *
 * InDesign styles  (lazy `indesign`)
 * ===================================================================== */

function getApp() {
  return require("indesign").app;
}

function hasOpenDocument() {
  try {
    return getApp().documents.length > 0;
  } catch (e) {
    return false;
  }
}

/*
 * Run `fn` as a single named undo step. Grouping the work also lets InDesign
 * batch recomposition, which makes large imports noticeably faster. If this
 * build rejects doScript-with-a-function, fall back to running fn directly —
 * but never run fn twice if it already started and threw.
 */
function withUndo(name, fn) {
  const id = require("indesign");
  let started = false;
  const wrapped = () => {
    started = true;
    return fn();
  };
  try {
    return id.app.doScript(wrapped, id.ScriptLanguage.UXPSCRIPT, undefined, id.UndoModes.ENTIRE_SCRIPT, name);
  } catch (e) {
    if (started) throw e; // fn itself failed — surface it
    return fn(); // doScript unavailable — run unwrapped
  }
}

/*
 * Read element i from either a plain Array (e.g. doc.allParagraphStyles) or a
 * DOM collection (e.g. story.paragraphs). Arrays use [i]; collections use
 * .item(i).
 */
function atIndex(coll, i) {
  try {
    if (coll && typeof coll.item === "function") {
      return coll.item(i);
    }
  } catch (e) {
    /* fall back to bracket access */
  }
  return coll[i];
}

function collectNames(collection) {
  const out = [];
  try {
    for (let i = 0; i < collection.length; i++) {
      out.push(atIndex(collection, i).name);
    }
  } catch (e) {
    /* ignore */
  }
  return out;
}

function listParagraphStyleNames() {
  if (!hasOpenDocument()) return [];
  return collectNames(getApp().activeDocument.allParagraphStyles);
}

function listCharacterStyleNames() {
  if (!hasOpenDocument()) return [];
  return collectNames(getApp().activeDocument.allCharacterStyles);
}

function resolveByName(collection, name) {
  if (!name) return null;
  try {
    for (let i = 0; i < collection.length; i++) {
      const item = atIndex(collection, i);
      if (item && item.name === name) return item;
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

function resolveParagraphStyle(doc, name) {
  return name ? resolveByName(doc.allParagraphStyles, name) : null;
}

function resolveCharacterStyle(doc, name) {
  return name ? resolveByName(doc.allCharacterStyles, name) : null;
}

/* ===================================================================== *
 * Importer  (lazy `indesign`)
 * ===================================================================== */

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

function num(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function appendText(story, text) {
  story.insertionPoints.lastItem().contents = text;
}

function getTargetStory(app) {
  const doc = app.activeDocument;

  try {
    const sel = app.selection;
    if (sel && sel.length === 1 && sel[0] && sel[0].parentStory) {
      return { story: sel[0].parentStory, doc: doc, created: false };
    }
  } catch (e) {
    /* fall through */
  }

  const page = app.activeWindow.activePage;
  const b = page.bounds;
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
    /* use full bounds */
  }

  const frame = page.textFrames.add();
  frame.geometricBounds = [top, left, bottom, right];
  return { story: frame.parentStory, doc: doc, created: true, frame: frame };
}

function tryHyperlink(doc, story, fromIndex, toIndex, url) {
  try {
    if (!/^[a-z]+:/i.test(url)) return;
    const range = story.characters.itemByRange(fromIndex, toIndex);
    const source = doc.hyperlinkTextSources.add(range);
    const dest = doc.hyperlinkURLDestinations.add(url);
    doc.hyperlinks.add(source, dest);
  } catch (e) {
    /* best-effort */
  }
}

function appendParagraph(ctx, runs, styleKey, prefix) {
  const story = ctx.story;
  const doc = ctx.doc;
  const mapping = ctx.mapping;

  let plain = runs.map((r) => r.text).join("");
  if (prefix) plain = prefix + plain;

  const start = story.characters.length;
  appendText(story, plain + "\r");

  const pStyle = resolveParagraphStyle(doc, mapping.paragraph[styleKey]);
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
          const cStyle = resolveCharacterStyle(doc, mapping.character[key]);
          if (cStyle) {
            try {
              story.characters.itemByRange(cursor, cursor + rlen - 1).appliedCharacterStyle = cStyle;
            } catch (e) {
              /* ignore */
            }
          }
        }
        if (run.url) tryHyperlink(doc, story, cursor, cursor + rlen - 1, run.url);
      }
      cursor += rlen;
    }
  } else if (pStyle) {
    try {
      story.characters.itemByRange(start, start).appliedParagraphStyle = pStyle;
    } catch (e) {
      /* ignore */
    }
  }
}

function listMarker(kind, block, ctx) {
  if (ctx.options.includeListMarkers === false) return "";
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
  const style = resolveParagraphStyle(doc, ctx.mapping.paragraph.horizontalRule);
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
  if (!cols) return;

  appendText(story, "\r");
  const table = story.insertionPoints.lastItem().tables.add();

  try {
    table.columnCount = cols;
    table.headerRowCount = 1;
    table.bodyRowCount = block.rows.length;
  } catch (e) {
    /* best-effort sizing */
  }

  // Column alignment from the delimiter row (:-- / :--: / --:).
  let jmap = null;
  try {
    const J = require("indesign").Justification;
    jmap = { left: J.LEFT_ALIGN, center: J.CENTER_ALIGN, right: J.RIGHT_ALIGN };
  } catch (e) {
    /* alignment is best-effort */
  }

  for (let r = 0; r < allRows.length; r++) {
    const row = allRows[r] || [];
    for (let c = 0; c < cols; c++) {
      const cellText = row[c] !== undefined ? stripInline(row[c]) : "";
      try {
        const cell = table.rows.item(r).cells.item(c);
        cell.contents = cellText;
        const key = r === 0 ? "tableHeader" : "tableCell";
        const pStyle = resolveParagraphStyle(doc, mapping.paragraph[key] || mapping.paragraph.tableCell);
        if (pStyle) cell.texts.item(0).appliedParagraphStyle = pStyle;
        const al = block.aligns && block.aligns[c];
        if (jmap && al && jmap[al]) cell.texts.item(0).justification = jmap[al];
      } catch (e) {
        /* skip cell */
      }
    }
  }
}

function insertImage(ctx, block) {
  const alt = block.alt || block.url || "[image]";
  appendParagraph(ctx, [{ text: alt, flags: [], url: null }], "image");
}

function applyToDocument(blocks, mapping, options) {
  const app = getApp();
  if (!app.documents.length) {
    throw new Error("Open or create an InDesign document first.");
  }

  const target = getTargetStory(app);
  const ctx = { story: target.story, doc: target.doc, mapping: mapping, options: options || {} };

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
      /* keep going */
    }
  }

  return { created: target.created, blocks: blocks.length };
}

/* ===================================================================== *
 * Panel UI
 * ===================================================================== */

let currentMapping = loadMapping();
const pickerRefs = { paragraph: {}, character: {} };

function $(id) {
  return document.getElementById(id);
}

function setStatus(msg, kind) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
  el.className = "status" + (kind ? " " + kind : "");
}

function runImport(text, name) {
  try {
    if (!hasOpenDocument()) {
      setStatus("Open an InDesign document first.", "error");
      return;
    }
    const blocks = parseMarkdown(text);
    if (!blocks.length) {
      setStatus("Nothing to import — the file looks empty.", "error");
      return;
    }
    let res = null;
    withUndo("Import Markdown (inDown)", () => {
      res = applyToDocument(blocks, currentMapping, { includeListMarkers: true });
    });
    setStatus(
      "Imported " +
        (name || "markdown") +
        " — " +
        res.blocks +
        " block" +
        (res.blocks === 1 ? "" : "s") +
        (res.created ? " into a new text frame." : "."),
      "ok"
    );
  } catch (e) {
    setStatus("Import failed: " + (e && e.message ? e.message : e), "error");
  }
}

async function importFromPicker() {
  try {
    const storage = require("uxp").storage;
    const fs = storage.localFileSystem;
    const file = await fs.getFileForOpening({
      allowMultiple: false,
      types: ["md", "markdown", "txt", "text"]
    });
    if (!file) return;
    const text = await file.read({ format: storage.formats.utf8 });
    runImport(text, file.name);
  } catch (e) {
    setStatus("Could not open file: " + (e && e.message ? e.message : e), "error");
  }
}

function wireDropzone() {
  const dz = $("dropzone");
  if (!dz) return;

  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.add("over");
    })
  );
  ["dragleave", "dragend"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.remove("over");
    })
  );

  dz.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dz.classList.remove("over");
    try {
      const storage = require("uxp").storage;
      const dt = e.dataTransfer;
      let text = null;
      let name = "dropped file";
      if (dt && dt.files && dt.files.length) {
        const f = dt.files[0];
        name = f.name || name;
        if (typeof f.read === "function") {
          text = await f.read({ format: storage.formats.utf8 });
        } else if (typeof f.text === "function") {
          text = await f.text();
        } else if (f.path) {
          // Some UXP builds only expose a filesystem path on dropped files.
          try {
            const entry = await storage.localFileSystem.getEntryWithUrl("file://" + f.path);
            if (entry && typeof entry.read === "function") {
              text = await entry.read({ format: storage.formats.utf8 });
            }
          } catch (pe) {
            /* fall through to the error message below */
          }
        }
      }
      if (text != null) runImport(text, name);
      else setStatus("Couldn’t read the dropped file here — use the Import button.", "error");
    } catch (err) {
      setStatus("Drop failed: " + (err && err.message ? err.message : err) + " — use the Import button.", "error");
    }
  });
}

function showView(which) {
  $("view-import").classList.toggle("hidden", which !== "import");
  $("view-settings").classList.toggle("hidden", which !== "settings");
  if (which === "settings") renderSettings();
}

function makePickerRow(container, label, names, current, store, key) {
  const row = document.createElement("div");
  row.className = "map-row";

  const lab = document.createElement("div");
  lab.className = "map-label";
  lab.textContent = label;
  row.appendChild(lab);

  const picker = document.createElement("sp-picker");
  picker.setAttribute("size", "s");
  picker.className = "map-picker";

  const menu = document.createElement("sp-menu");
  picker.appendChild(menu);

  const none = document.createElement("sp-menu-item");
  none.textContent = "(None)";
  none.setAttribute("value", "");
  menu.appendChild(none);

  names.forEach((n) => {
    const it = document.createElement("sp-menu-item");
    it.textContent = n;
    it.setAttribute("value", n);
    if (n === current) it.setAttribute("selected", "");
    menu.appendChild(it);
  });

  // Add the row to the DOM BEFORE assigning picker.value: on some sp-picker
  // builds that assignment can throw, and doing it first would drop the whole
  // row. The selection is also reflected by the menu-item's 'selected'
  // attribute above, and the saved value is kept in _selectedValue regardless.
  row.appendChild(picker);
  container.appendChild(row);
  store[key] = picker;

  picker._selectedValue = current || "";
  picker.addEventListener("change", (e) => {
    picker._selectedValue = (e.target && e.target.value) || "";
  });
  if (current) {
    try {
      picker.value = current;
    } catch (e) {
      /* selection still shown via the menu-item 'selected' attribute */
    }
  }
}

function renderSettings() {
  const hasDoc = hasOpenDocument();
  const noDoc = $("no-doc");
  if (noDoc) noDoc.classList.toggle("hidden", hasDoc);

  let paraNames = [];
  let charNames = [];
  try {
    paraNames = listParagraphStyleNames();
  } catch (e) {
    /* ignore */
  }
  try {
    charNames = listCharacterStyleNames();
  } catch (e) {
    /* ignore */
  }

  const pl = $("para-list");
  const cl = $("char-list");

  // Clear BOTH lists up front so a later failure can never leave one list
  // showing stale rows from a previous open.
  if (pl) pl.innerHTML = "";
  if (cl) cl.innerHTML = "";
  pickerRefs.paragraph = {};
  pickerRefs.character = {};

  if (pl) {
    PARAGRAPH_ELEMENTS.forEach((el) => {
      try {
        makePickerRow(pl, el.label, paraNames, currentMapping.paragraph[el.key], pickerRefs.paragraph, el.key);
      } catch (e) {
        /* skip a single bad row, keep the rest */
      }
    });
  }
  if (cl) {
    CHARACTER_ELEMENTS.forEach((el) => {
      try {
        makePickerRow(cl, el.label, charNames, currentMapping.character[el.key], pickerRefs.character, el.key);
      } catch (e) {
        /* skip a single bad row, keep the rest */
      }
    });
  }
}

function readPicker(picker) {
  if (!picker) return "";
  if (picker._selectedValue !== undefined && picker._selectedValue !== null) return picker._selectedValue;
  return picker.value || "";
}

function saveSettings() {
  const m = emptyMapping();
  // If a picker row is missing (failed to render), keep the previously saved
  // value for that key instead of silently wiping it with "".
  PARAGRAPH_ELEMENTS.forEach((el) => {
    const picker = pickerRefs.paragraph[el.key];
    m.paragraph[el.key] = picker ? readPicker(picker) : currentMapping.paragraph[el.key] || "";
  });
  CHARACTER_ELEMENTS.forEach((el) => {
    const picker = pickerRefs.character[el.key];
    m.character[el.key] = picker ? readPicker(picker) : currentMapping.character[el.key] || "";
  });
  currentMapping = m;
  saveMapping(m);
  setStatus("Style mapping saved.", "ok");
  showView("import");
}

function init() {
  if (init._done) return;
  init._done = true;

  const importBtn = $("btn-import");
  const settingsBtn = $("btn-settings");
  const backBtn = $("btn-back");
  const saveBtn = $("btn-save");
  const refreshBtn = $("btn-refresh");

  if (importBtn) importBtn.addEventListener("click", importFromPicker);
  if (settingsBtn) settingsBtn.addEventListener("click", () => showView("settings"));
  if (backBtn) backBtn.addEventListener("click", () => showView("import"));
  if (saveBtn) saveBtn.addEventListener("click", saveSettings);
  if (refreshBtn) refreshBtn.addEventListener("click", renderSettings);

  const formatBtn = $("btn-format");
  const revealBtn = $("btn-reveal");
  const exportBtn = $("btn-export");
  const liveSwitch = $("sw-live");
  if (formatBtn) formatBtn.addEventListener("click", formatSelectionNow);
  if (revealBtn) revealBtn.addEventListener("click", toggleReveal);
  if (exportBtn) exportBtn.addEventListener("click", exportStoryMarkdown);
  if (liveSwitch) {
    liveSwitch.addEventListener("change", (e) => setLive(!!(e.target && e.target.checked)));
  }

  wireDropzone();
  setStatus("Ready. Drop a .md / .txt file above, or click Import.");
}

/* ===================================================================== *
 * In-place formatting (type Markdown directly) + Reveal syntax
 * ===================================================================== */

/* The text frame / story the cursor is in (no new frame is created here). */
function getActiveStory(app) {
  try {
    const sel = app.selection;
    if (sel && sel.length === 1 && sel[0] && sel[0].parentStory) {
      return sel[0].parentStory;
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

/* One find/change GREP pass: strip the syntax (keep $1) and apply a style. */
function grepFormat(app, target, find, opts) {
  const id = require("indesign");
  try {
    app.findGrepPreferences = id.NothingEnum.NOTHING;
    app.changeGrepPreferences = id.NothingEnum.NOTHING;
    app.findGrepPreferences.findWhat = find;
    app.changeGrepPreferences.changeTo = "$1";
    if (opts.charStyle) app.changeGrepPreferences.appliedCharacterStyle = opts.charStyle;
    if (opts.paraStyle) app.changeGrepPreferences.appliedParagraphStyle = opts.paraStyle;
    target.changeGrep();
  } catch (e) {
    /* ignore individual rule errors */
  } finally {
    try {
      app.findGrepPreferences = id.NothingEnum.NOTHING;
      app.changeGrepPreferences = id.NothingEnum.NOTHING;
    } catch (e) {
      /* ignore */
    }
  }
}

/*
 * Convert completed Markdown already present in a story, in place.
 * `scope` (optional Text range) restricts the work — the live timer passes
 * the caret's paragraph plus its predecessor so big stories aren't re-scanned
 * on every tick. Without it, the whole story is processed.
 */
function formatStory(story, mapping, scope) {
  const app = getApp();
  const doc = app.activeDocument;
  const target = scope || story;
  const cs = (k) => resolveCharacterStyle(doc, mapping.character[k]);
  const ps = (k) => resolveParagraphStyle(doc, mapping.paragraph[k]);

  // Headings are single-line. If a heading paragraph style repeats on
  // consecutive paragraphs (e.g. you pressed Return after a heading), the
  // later ones inherited the style — reset them to Body so a new line doesn't
  // keep the heading. A genuinely different next heading (## after #) is a
  // different style, so it is preserved; anything you actually type is
  // re-styled by the passes below.
  const bodyStyle = ps("paragraph");
  if (bodyStyle) {
    const headingNames = {};
    for (let n = 1; n <= 6; n++) {
      const s = ps("h" + n);
      if (s) headingNames[s.name] = true;
    }
    try {
      const paras = target.paragraphs;
      const count = paras.length;
      const resetIdx = [];
      let prevName = null;
      for (let i = 0; i < count; i++) {
        const nm = atIndex(paras, i).appliedParagraphStyle.name;
        if (headingNames[nm] && nm === prevName) resetIdx.push(i);
        prevName = nm;
      }
      for (let k = 0; k < resetIdx.length; k++) {
        try {
          atIndex(paras, resetIdx[k]).appliedParagraphStyle = bodyStyle;
        } catch (e) {
          /* ignore */
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  // Inline (only runs for constructs the user has mapped to a character style).
  const inline = [
    ["boldItalic", "\\*\\*\\*(.+?)\\*\\*\\*"],
    ["boldItalic", "___(.+?)___"],
    ["bold", "\\*\\*(.+?)\\*\\*"],
    ["bold", "__(.+?)__"],
    ["strikethrough", "~~(.+?)~~"],
    ["highlight", "==(.+?)=="],
    ["inlineCode", "`(.+?)`"],
    ["italic", "\\*(.+?)\\*"],
    ["italic", "(?<![A-Za-z0-9_])_(.+?)_(?![A-Za-z0-9_])"],
    ["link", "\\[(.+?)\\]\\((.+?)\\)"]
  ];
  inline.forEach((rule) => {
    const style = cs(rule[0]);
    if (style) grepFormat(app, target, rule[1], { charStyle: style });
  });

  // Headings h6..h1 (longest hash run first so shorter ones don't pre-empt).
  for (let n = 6; n >= 1; n--) {
    const style = ps("h" + n);
    if (style) grepFormat(app, target, "^#{" + n + "}\\s+(.+)$", { paraStyle: style });
  }
  // Task list before bulleted list (task lines begin with a bullet too).
  if (ps("taskList")) grepFormat(app, target, "^[-*+]\\s+\\[[ xX]\\]\\s+(.+)$", { paraStyle: ps("taskList") });
  if (ps("blockquote")) grepFormat(app, target, "^>\\s?(.+)$", { paraStyle: ps("blockquote") });
  if (ps("unorderedList")) grepFormat(app, target, "^[-*+]\\s+(.+)$", { paraStyle: ps("unorderedList") });
  if (ps("orderedList")) grepFormat(app, target, "^\\d+[.)]\\s+(.+)$", { paraStyle: ps("orderedList") });
}

function formatSelectionNow() {
  if (revealState) {
    setStatus("Turn off Reveal formatting before formatting.", "error");
    return;
  }
  if (!hasOpenDocument()) {
    setStatus("Open a document first.", "error");
    return;
  }
  const story = getActiveStory(getApp());
  if (!story) {
    setStatus("Click into a text frame (or select one) first.", "error");
    return;
  }
  try {
    withUndo("Format Markdown (inDown)", () => formatStory(story, currentMapping));
    setStatus("Formatted Markdown in the current story.", "ok");
  } catch (e) {
    setStatus("Format failed: " + (e && e.message ? e.message : e), "error");
  }
}

let liveTimer = null;
let lastLiveSig = null;

/*
 * Cheap change signature: story id + length + the caret paragraph's text.
 * If it matches the previous tick, nothing relevant changed and the GREP
 * passes are skipped entirely (idle ticks become nearly free).
 */
function liveSignature(app, story) {
  try {
    let paraText = "";
    try {
      const sel = app.selection;
      if (sel && sel.length === 1 && sel[0].paragraphs && sel[0].paragraphs.length > 0) {
        paraText = String(sel[0].paragraphs.item(0).contents || "");
      }
    } catch (e) {
      /* signature still useful without the paragraph text */
    }
    return story.id + ":" + story.characters.length + ":" + paraText;
  } catch (e) {
    return null;
  }
}

/*
 * Restrict live formatting to the caret's paragraph(s) plus the previous
 * paragraph (so a construct completed by pressing Return, and the
 * heading→Body reset, still work). Returns null to fall back to full story.
 */
function caretScope(app, story) {
  try {
    const sel = app.selection;
    if (!sel || sel.length !== 1) return null;
    const selParas = sel[0].paragraphs;
    if (!selParas || selParas.length === 0) return null;
    const firstPara = selParas.item(0);
    const lastPara = selParas.item(selParas.length - 1);
    let startIdx = firstPara.characters.firstItem().index;
    try {
      const prev = story.paragraphs.previousItem(firstPara);
      if (prev) startIdx = prev.characters.firstItem().index;
    } catch (e) {
      /* caret is in the first paragraph */
    }
    const endIdx = lastPara.characters.lastItem().index;
    if (endIdx < startIdx) return null;
    return story.characters.itemByRange(startIdx, endIdx);
  } catch (e) {
    return null;
  }
}

function tickLive() {
  try {
    if (revealState || !hasOpenDocument()) return;
    const app = getApp();
    const story = getActiveStory(app);
    if (!story) return;
    const sig = liveSignature(app, story);
    if (sig !== null && sig === lastLiveSig) return; // nothing changed
    formatStory(story, currentMapping, caretScope(app, story));
    lastLiveSig = liveSignature(app, story); // re-read: formatting changes text
  } catch (e) {
    /* ignore – keep the timer alive */
  }
}
function setLive(on) {
  if (on) {
    if (!liveTimer) liveTimer = setInterval(tickLive, 1200);
    setStatus("Live auto-format on — completed Markdown converts as you type.", "ok");
  } else if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
    setStatus("Live auto-format off.");
  }
}

/* ---- Reveal formatting (show the syntax again, in light vibrant blue) ---- */

const SYNTAX_STYLE_NAME = "inDown Syntax";

function ensureSyntaxStyle(doc) {
  const id = require("indesign");
  let color = doc.colors.itemByName("inDown Syntax Blue");
  try {
    if (!color.isValid) {
      color = doc.colors.add();
      color.name = "inDown Syntax Blue";
      color.model = id.ColorModel.PROCESS;
      color.space = id.ColorSpace.RGB;
      color.colorValue = [77, 166, 255];
    }
  } catch (e) {
    color = null;
  }
  let style = doc.characterStyles.itemByName(SYNTAX_STYLE_NAME);
  try {
    if (!style.isValid) {
      style = doc.characterStyles.add();
      style.name = SYNTAX_STYLE_NAME;
    }
    if (color && color.isValid) style.fillColor = color;
  } catch (e) {
    /* ignore */
  }
  return style;
}

function reverseParaMarkers(mapping) {
  const map = {};
  const add = (key, marker) => {
    const name = mapping.paragraph[key];
    if (name && !(name in map)) map[name] = marker;
  };
  add("h1", "# "); add("h2", "## "); add("h3", "### ");
  add("h4", "#### "); add("h5", "##### "); add("h6", "###### ");
  add("blockquote", "> "); add("unorderedList", "- ");
  add("orderedList", "1. "); add("taskList", "- [ ] ");
  return map;
}

function reverseCharMarkers(mapping) {
  const map = {};
  const add = (key, marker) => {
    const name = mapping.character[key];
    if (name && !(name in map)) map[name] = marker;
  };
  add("bold", "**"); add("italic", "*"); add("boldItalic", "***");
  add("inlineCode", "`"); add("strikethrough", "~~"); add("highlight", "==");
  return map;
}

function revealShow(story, doc, mapping) {
  const syntaxStyle = ensureSyntaxStyle(doc);
  const paraMap = reverseParaMarkers(mapping);
  const charMap = reverseCharMarkers(mapping);
  const edits = [];

  const paras = story.paragraphs;
  for (let i = 0; i < paras.length; i++) {
    try {
      const p = atIndex(paras, i);
      const marker = paraMap[p.appliedParagraphStyle.name];
      if (marker && p.characters.length > 0) {
        edits.push({ index: p.characters.firstItem().index, text: marker, kind: 1 });
      }
    } catch (e) {
      /* ignore */
    }
  }

  const ranges = story.textStyleRanges;
  for (let i = 0; i < ranges.length; i++) {
    try {
      const tsr = atIndex(ranges, i);
      const name = tsr.appliedCharacterStyle.name;
      if (name === SYNTAX_STYLE_NAME) continue;
      const marker = charMap[name];
      if (marker && tsr.characters.length > 0) {
        edits.push({ index: tsr.characters.firstItem().index, text: marker, kind: 0 });
        edits.push({ index: tsr.characters.lastItem().index + 1, text: marker, kind: 0 });
      }
    } catch (e) {
      /* ignore */
    }
  }

  // Apply from the end backwards so earlier indices stay valid. When a
  // character-run marker and a paragraph marker land at the same index
  // (styled run starting at paragraph start), apply the character marker
  // first so the paragraph marker ends up outermost: "# **Title", not
  // "**# Title".
  edits.sort((a, b) => b.index - a.index || a.kind - b.kind);
  for (let i = 0; i < edits.length; i++) {
    try {
      const e = edits[i];
      story.insertionPoints.item(e.index).contents = e.text;
      story.characters.itemByRange(e.index, e.index + e.text.length - 1).appliedCharacterStyle = syntaxStyle;
    } catch (err) {
      /* ignore */
    }
  }
}

function revealHide(story) {
  const spans = [];
  try {
    const ranges = story.textStyleRanges;
    for (let i = 0; i < ranges.length; i++) {
      try {
        const tsr = atIndex(ranges, i);
        if (tsr.appliedCharacterStyle.name === SYNTAX_STYLE_NAME && tsr.characters.length > 0) {
          spans.push([tsr.characters.firstItem().index, tsr.characters.lastItem().index]);
        }
      } catch (e) {
        /* ignore */
      }
    }
  } catch (e) {
    /* ignore */
  }
  spans.sort((a, b) => b[0] - a[0]);
  for (let i = 0; i < spans.length; i++) {
    try {
      story.characters.itemByRange(spans[i][0], spans[i][1]).remove();
    } catch (e) {
      try {
        story.characters.itemByRange(spans[i][0], spans[i][1]).contents = "";
      } catch (e2) {
        /* ignore */
      }
    }
  }
}

let revealState = false;
let revealedStory = null; // hide must target the story that was revealed,
                          // not whatever story happens to be selected now
function toggleReveal() {
  if (!hasOpenDocument()) {
    setStatus("Open a document first.", "error");
    return;
  }
  const app = getApp();
  const btn = $("btn-reveal");
  try {
    if (!revealState) {
      const story = getActiveStory(app);
      if (!story) {
        setStatus("Click into a text frame (or select one) first.", "error");
        return;
      }
      revealShow(story, app.activeDocument, currentMapping);
      revealState = true;
      revealedStory = story;
      if (btn) btn.textContent = "Hide formatting";
      setStatus("Showing Markdown syntax in blue.", "ok");
    } else {
      let story = revealedStory;
      try {
        if (!story || story.isValid === false) story = getActiveStory(app);
      } catch (e) {
        story = getActiveStory(app);
      }
      if (story) revealHide(story);
      revealState = false;
      revealedStory = null;
      if (btn) btn.textContent = "Reveal formatting";
      setStatus("Hid Markdown syntax.", "ok");
    }
  } catch (e) {
    setStatus("Reveal failed: " + (e && e.message ? e.message : e), "error");
  }
}

/* ===================================================================== *
 * Export: story → Markdown (reverse of import, driven by the same mapping)
 * ===================================================================== */

/* styleName -> element key (first mapped key wins, like Reveal). */
function reverseParaKeys(mapping) {
  const map = {};
  PARAGRAPH_ELEMENTS.forEach((el) => {
    const name = mapping.paragraph[el.key];
    if (name && !(name in map)) map[name] = el.key;
  });
  return map;
}

/* Hyperlink spans in this story: [{start, end, url}] for URL reconstruction. */
function collectStoryLinks(doc, story) {
  const out = [];
  try {
    const hls = doc.hyperlinks;
    for (let i = 0; i < hls.length; i++) {
      try {
        const h = atIndex(hls, i);
        const srcText = h.source && h.source.sourceText;
        if (!srcText || !srcText.parentStory || srcText.parentStory.id !== story.id) continue;
        const url = h.destination && h.destination.destinationURL;
        if (!url) continue;
        out.push({
          start: srcText.characters.firstItem().index,
          end: srcText.characters.lastItem().index,
          url: url
        });
      } catch (e) {
        /* skip this hyperlink */
      }
    }
  } catch (e) {
    /* no links */
  }
  return out;
}

/* Inline content of one paragraph with character-style markers re-applied. */
function paragraphInnerMarkdown(p, charMap, links) {
  let inner = "";
  const ranges = p.textStyleRanges;
  for (let i = 0; i < ranges.length; i++) {
    try {
      const tsr = atIndex(ranges, i);
      let t = String(tsr.contents || "");
      t = t.replace(/\r+$/, "");
      if (!t) continue;
      const sname = tsr.appliedCharacterStyle.name;
      if (sname === SYNTAX_STYLE_NAME) continue; // revealed markers never export

      let url = null;
      try {
        const startIdx = tsr.characters.firstItem().index;
        for (let k = 0; k < links.length; k++) {
          if (startIdx >= links[k].start && startIdx <= links[k].end) {
            url = links[k].url;
            break;
          }
        }
      } catch (e) {
        /* no link info */
      }

      const marker = charMap[sname];
      if (url) {
        inner += "[" + t + "](" + url + ")";
      } else if (marker) {
        // Keep leading/trailing spaces outside the markers: "**bold** " not "**bold **".
        const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(t);
        inner += m[1] + (m[2] ? marker + m[2] + marker : "") + m[3];
      } else {
        inner += t;
      }
    } catch (e) {
      /* skip range */
    }
  }
  return inner;
}

/* Re-derive the Markdown list prefix from imported literal markers, if any. */
function listLineMarkdown(key, inner) {
  let indent = "";
  let body = inner;
  const im = /^(\t+)/.exec(body);
  if (im) {
    indent = "  ".repeat(im[1].length);
    body = body.slice(im[1].length);
  }
  if (key === "unorderedList") return indent + "- " + body.replace(/^•\t/, "");
  if (key === "orderedList") {
    const om = /^(\d+)[.)]\t/.exec(body);
    if (om) return indent + om[1] + ". " + body.slice(om[0].length);
    return indent + "1. " + body;
  }
  if (key === "taskList") {
    const tm = /^([☐☑])\t/.exec(body);
    const checked = tm ? tm[1] === "☑" : false;
    if (tm) body = body.slice(tm[0].length);
    return indent + "- [" + (checked ? "x" : " ") + "] " + body;
  }
  return inner;
}

const HEADING_PREFIX = { h1: "# ", h2: "## ", h3: "### ", h4: "#### ", h5: "##### ", h6: "###### " };
const LIST_KEYS = { unorderedList: true, orderedList: true, taskList: true };

function storyToMarkdown(story, doc, mapping) {
  const paraKeys = reverseParaKeys(mapping);
  const charMap = reverseCharMarkers(mapping);
  const links = collectStoryLinks(doc, story);

  const out = [];
  let fence = null; // accumulates consecutive codeBlock paragraphs
  let prevKey = null;

  const flushFence = () => {
    if (fence !== null) {
      out.push("```\n" + fence.join("\n") + "\n```");
      fence = null;
    }
  };

  const paras = story.paragraphs;
  for (let i = 0; i < paras.length; i++) {
    let key = null;
    let line = "";
    try {
      const p = atIndex(paras, i);
      key = paraKeys[p.appliedParagraphStyle.name] || null;

      if (key === "codeBlock") {
        // Raw contents — code must not gain inline markers.
        const raw = String(p.contents || "").replace(/\r+$/, "");
        if (fence === null) fence = [];
        fence.push(raw);
        prevKey = key;
        continue;
      }
      flushFence();

      if (key === "horizontalRule") {
        out.push("---");
        prevKey = key;
        continue;
      }

      const inner = paragraphInnerMarkdown(p, charMap, links);
      if (!inner.trim()) {
        prevKey = key;
        continue;
      }

      if (HEADING_PREFIX[key]) line = HEADING_PREFIX[key] + inner;
      else if (key === "blockquote") line = "> " + inner;
      else if (LIST_KEYS[key]) line = listLineMarkdown(key, inner);
      else line = inner; // body / image-caption / table styles / unmapped

      // Consecutive items of the same list kind stay adjacent (no blank line).
      if (LIST_KEYS[key] && key === prevKey && out.length) {
        out[out.length - 1] += "\n" + line;
      } else {
        out.push(line);
      }
      prevKey = key;
    } catch (e) {
      prevKey = key;
      /* skip paragraph */
    }
  }
  flushFence();

  return out.join("\n\n") + (out.length ? "\n" : "");
}

async function exportStoryMarkdown() {
  if (revealState) {
    setStatus("Turn off Reveal formatting before exporting.", "error");
    return;
  }
  if (!hasOpenDocument()) {
    setStatus("Open a document first.", "error");
    return;
  }
  const app = getApp();
  const story = getActiveStory(app);
  if (!story) {
    setStatus("Click into a text frame (or select one) first.", "error");
    return;
  }
  try {
    const md = storyToMarkdown(story, app.activeDocument, currentMapping);
    if (!md.trim()) {
      setStatus("The story is empty — nothing to export.", "error");
      return;
    }

    let copied = false;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        if (typeof navigator.clipboard.setContent === "function") {
          await navigator.clipboard.setContent({ "text/plain": md });
          copied = true;
        } else if (typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(md);
          copied = true;
        }
      }
    } catch (e) {
      /* fall back to saving a file */
    }

    if (copied) {
      setStatus("Story copied to the clipboard as Markdown.", "ok");
      return;
    }
    const storage = require("uxp").storage;
    const file = await storage.localFileSystem.getFileForSaving("export.md", { types: ["md"] });
    if (file) {
      await file.write(md, { format: storage.formats.utf8 });
      setStatus("Saved Markdown as " + file.name + ".", "ok");
    }
  } catch (e) {
    setStatus("Export failed: " + (e && e.message ? e.message : e), "error");
  }
}

/* ===================================================================== *
 * Bootstrap
 * ===================================================================== */

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}

try {
  const { entrypoints } = require("uxp");
  entrypoints.setup({
    panels: {
      "indown.panel.main": {
        show() {
          try {
            init();
          } catch (e) {
            /* ignore */
          }
        },
        menuItems: [
          { id: "import", label: "Import Markdown File…" },
          { id: "settings", label: "Style Mapping…" }
        ],
        invokeMenu(id) {
          try {
            if (id === "import") importFromPicker();
            else if (id === "settings") showView("settings");
          } catch (e) {
            /* ignore */
          }
        }
      }
    }
  });
} catch (e) {
  /* not running inside UXP (e.g. Node tests) */
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseMarkdown, parseInline, FLAG, pickCharKey, emptyMapping };
}
