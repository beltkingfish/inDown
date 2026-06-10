"use strict";

/*
 * A focused Markdown parser covering the Basic + Extended syntax that maps
 * cleanly onto InDesign paragraph/character styles.
 *
 * Output is a flat list of "blocks". Each block carries a `styleKey` that the
 * importer resolves against the user's style mapping. Inline formatting is
 * represented as "runs": { text, flags: [...], url }.
 *
 * This module has no InDesign dependency, so it can be unit-tested in Node.
 */

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

/* ----------------------------------------------------------------------- *
 * Inline parsing
 * ----------------------------------------------------------------------- */

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

      // Backslash escape
      if ((m = /^\\([\\`*_{}\[\]()#+\-.!~>|=])/.exec(rest))) {
        local += m[1];
        i += m[0].length;
        continue;
      }

      // Inline code span (no inner formatting)
      if ((m = /^(`+)([\s\S]*?)\1(?!`)/.exec(rest))) {
        flushLocal();
        emit(m[2].replace(/^ | $/g, ""), combine(ctx, FLAG.CODE));
        i += m[0].length;
        continue;
      }

      // Image: rendered as alt text (placement handled at block level)
      if ((m = /^!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/.exec(rest))) {
        flushLocal();
        emit(m[1] || m[2], combine(ctx, null));
        i += m[0].length;
        continue;
      }

      // Link
      if ((m = /^\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/.exec(rest))) {
        flushLocal();
        walk(m[1], combine(ctx, FLAG.LINK, m[2]));
        i += m[0].length;
        continue;
      }

      // Autolink
      if ((m = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/.exec(rest))) {
        flushLocal();
        emit(m[1], combine(ctx, FLAG.LINK, m[1]));
        i += m[0].length;
        continue;
      }

      // Bold + italic
      if ((m = /^\*\*\*([\s\S]+?)\*\*\*/.exec(rest)) || (m = /^___([\s\S]+?)___/.exec(rest))) {
        flushLocal();
        walk(m[1], combine(combine(ctx, FLAG.BOLD), FLAG.ITALIC));
        i += m[0].length;
        continue;
      }

      // Bold
      if ((m = /^\*\*([\s\S]+?)\*\*/.exec(rest)) || (m = /^__([\s\S]+?)__/.exec(rest))) {
        flushLocal();
        walk(m[1], combine(ctx, FLAG.BOLD));
        i += m[0].length;
        continue;
      }

      // Strikethrough
      if ((m = /^~~([\s\S]+?)~~/.exec(rest))) {
        flushLocal();
        walk(m[1], combine(ctx, FLAG.STRIKE));
        i += m[0].length;
        continue;
      }

      // Highlight
      if ((m = /^==([\s\S]+?)==/.exec(rest))) {
        flushLocal();
        walk(m[1], combine(ctx, FLAG.HIGHLIGHT));
        i += m[0].length;
        continue;
      }

      // Italic with '*'
      if ((m = /^\*([^\s*][\s\S]*?)\*/.exec(rest))) {
        flushLocal();
        walk(m[1], combine(ctx, FLAG.ITALIC));
        i += m[0].length;
        continue;
      }

      // Italic with '_' (not intra-word, e.g. snake_case stays literal)
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

/* ----------------------------------------------------------------------- *
 * Table helpers
 * ----------------------------------------------------------------------- */

function splitRow(line) {
  let s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
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

/* ----------------------------------------------------------------------- *
 * Block parsing
 * ----------------------------------------------------------------------- */

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
  return line.indexOf("|") >= 0 && next != null && RE.tableDelim.test(next);
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

    // Fenced code block
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
        i += 1; // consume closing fence
      }
      blocks.push({ type: "codeBlock", styleKey: "codeBlock", lang: lang, lines: code });
      continue;
    }

    // ATX heading
    if ((m = RE.heading.exec(line))) {
      const level = m[1].length;
      blocks.push({
        type: "heading",
        styleKey: "h" + level,
        level: level,
        runs: parseInline(m[2])
      });
      i += 1;
      continue;
    }

    // Horizontal rule
    if (RE.hr.test(line)) {
      blocks.push({ type: "horizontalRule", styleKey: "horizontalRule" });
      i += 1;
      continue;
    }

    // Table
    if (looksLikeTable(line, lines[i + 1])) {
      const tbl = parseTable(lines, i);
      blocks.push(tbl.block);
      i = tbl.next;
      continue;
    }

    // Blockquote (each non-empty inner line becomes a blockquote paragraph)
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

    // Lists (unordered / ordered / task)
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

    // Standalone image
    if ((m = RE.image.exec(line))) {
      blocks.push({ type: "image", styleKey: "image", alt: m[1], url: m[2] });
      i += 1;
      continue;
    }

    // Paragraph: gather consecutive lines until a blank line or a new block
    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && !isBlockStart(lines[i], lines[i + 1])) {
      para.push(lines[i]);
      i += 1;
    }
    const joined = para.join(" ").replace(/\s+/g, " ").trim();
    blocks.push({ type: "paragraph", styleKey: "paragraph", runs: parseInline(joined) });
  }

  return blocks;
}

module.exports = { parseMarkdown, parseInline, FLAG };
