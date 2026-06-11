"use strict";

/*
 * Lightweight assertions for the Markdown parser. No test framework required:
 *   node test/parser.test.js
 *
 * The parser module has no InDesign dependency, so it runs in plain Node.
 */

const assert = require("assert");
const { parseMarkdown, parseInline } = require("../main.js");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log("  ok - " + name);
}

function flagsOf(run) {
  return run.flags.slice().sort();
}

console.log("parseInline");

check("plain text is a single run", () => {
  const runs = parseInline("hello world");
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(runs[0].text, "hello world");
  assert.deepStrictEqual(runs[0].flags, []);
});

check("bold + italic + plain", () => {
  const runs = parseInline("a **b** and *c*");
  const styled = runs.filter((r) => r.flags.length);
  assert.strictEqual(styled.length, 2);
  assert.deepStrictEqual(flagsOf(styled[0]), ["bold"]);
  assert.deepStrictEqual(flagsOf(styled[1]), ["italic"]);
});

check("bold-italic combines flags", () => {
  const runs = parseInline("***x***");
  assert.deepStrictEqual(flagsOf(runs[0]), ["bold", "italic"]);
});

check("inline code is not further parsed", () => {
  const runs = parseInline("use `a*b*c` here");
  const code = runs.find((r) => r.flags.indexOf("code") >= 0);
  assert.strictEqual(code.text, "a*b*c");
});

check("link carries url and link flag", () => {
  const runs = parseInline("see [docs](https://example.com)");
  const link = runs.find((r) => r.url);
  assert.strictEqual(link.text, "docs");
  assert.strictEqual(link.url, "https://example.com");
  assert.ok(link.flags.indexOf("link") >= 0);
});

check("snake_case is not italicised", () => {
  const runs = parseInline("call my_func now");
  assert.strictEqual(runs.length, 1);
  assert.deepStrictEqual(runs[0].flags, []);
});

check("strikethrough and highlight", () => {
  const s = parseInline("~~gone~~")[0];
  const h = parseInline("==wow==")[0];
  assert.deepStrictEqual(flagsOf(s), ["strike"]);
  assert.deepStrictEqual(flagsOf(h), ["highlight"]);
});

check("escaped asterisks stay literal", () => {
  const runs = parseInline("a \\*b\\* c");
  assert.strictEqual(runs.map((r) => r.text).join(""), "a *b* c");
  assert.ok(runs.every((r) => r.flags.length === 0));
});

console.log("parseMarkdown");

check("headings map to h1..h6 style keys", () => {
  const blocks = parseMarkdown("# A\n\n## B\n\n###### F");
  assert.deepStrictEqual(
    blocks.map((b) => b.styleKey),
    ["h1", "h2", "h6"]
  );
});

check("paragraph lines are joined", () => {
  const blocks = parseMarkdown("one\ntwo\n\nthree");
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].runs.map((r) => r.text).join(""), "one two");
});

check("unordered, ordered and task lists", () => {
  const blocks = parseMarkdown("- a\n- b\n\n1. x\n2. y\n\n- [ ] todo\n- [x] done");
  const types = blocks.map((b) => b.type);
  assert.deepStrictEqual(types, [
    "unorderedList",
    "unorderedList",
    "orderedList",
    "orderedList",
    "taskList",
    "taskList"
  ]);
  assert.strictEqual(blocks[2].number, 1);
  assert.strictEqual(blocks[4].checked, false);
  assert.strictEqual(blocks[5].checked, true);
});

check("fenced code block keeps lines verbatim", () => {
  const blocks = parseMarkdown("```js\nconst a = 1;\nconst b = 2;\n```");
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].type, "codeBlock");
  assert.deepStrictEqual(blocks[0].lines, ["const a = 1;", "const b = 2;"]);
});

check("blockquote becomes blockquote blocks", () => {
  const blocks = parseMarkdown("> quote line one\n> quote line two");
  assert.ok(blocks.every((b) => b.type === "blockquote"));
  assert.strictEqual(blocks.length, 2);
});

check("horizontal rule", () => {
  const blocks = parseMarkdown("above\n\n---\n\nbelow");
  assert.strictEqual(blocks[1].type, "horizontalRule");
});

check("table parses header, aligns and rows", () => {
  const blocks = parseMarkdown("| A | B |\n| :-- | --: |\n| 1 | 2 |\n| 3 | 4 |");
  const t = blocks[0];
  assert.strictEqual(t.type, "table");
  assert.deepStrictEqual(t.header, ["A", "B"]);
  assert.deepStrictEqual(t.aligns, ["left", "right"]);
  assert.strictEqual(t.rows.length, 2);
  assert.deepStrictEqual(t.rows[1], ["3", "4"]);
});

check("standalone image block", () => {
  const blocks = parseMarkdown("![alt text](pic.png)");
  assert.strictEqual(blocks[0].type, "image");
  assert.strictEqual(blocks[0].alt, "alt text");
  assert.strictEqual(blocks[0].url, "pic.png");
});

console.log("\nAll " + passed + " checks passed.");
