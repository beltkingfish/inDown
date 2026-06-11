# inDown

Bring **Markdown** (`.md` / `.txt`) into Adobe InDesign — mapped to the
paragraph and character styles you've already built.

inDown is a UXP plugin. It parses Markdown (basic + extended syntax) and flows
it into your document, applying *your* styles: scope `#` to your "Heading 1"
style, `##` to "Heading 2", body text to "Body", and so on. Inline formatting
(bold, italic, code, links, …) maps to your character styles.

---

## Features

- **Two ways to import**
  - Drag a `.md` / `.txt` file onto the inDown panel's drop zone.
  - Click **Import Markdown File…** (a file picker, works like Place).
- **Format Markdown you type in InDesign**
  - **Format selection** — converts Markdown already typed in the current
    story, in place (strips the syntax, applies your mapped styles).
  - **Live auto-format** — a toggle that does the same automatically on an
    idle timer (~1.2 s) while you type. Pressing Return after a heading drops
    the new line back to your Body style.
  - **Reveal formatting** — shows the Markdown syntax again, in light blue,
    reconstructed from the applied styles; toggle off to remove it.
- **Export** — **Copy story as Markdown** reconstructs Markdown from the
  applied styles (headings, lists, blockquotes, code fences, rules, inline
  styles, and link URLs from InDesign hyperlinks) and puts it on the
  clipboard, or saves a `.md` if the clipboard is unavailable.
- **Style Mapping window** — scope every Markdown construct to a paragraph,
  character, table, or cell style from the active document. Saved between
  sessions.
  - **Tables** map to a native InDesign **Table Style** plus optional header /
    body **Cell Styles**. When a table style is mapped it owns the table's
    look (its region cascade can carry cell and paragraph styles); the
    table-header / table-body *paragraph* rows are used only as a fallback
    when no table style is mapped.
  - **Auto-map** fills empty rows by fuzzy-matching the document's style
    names (e.g. `H1`/`Heading 1` → Heading 1, `Body`/`P` → Body, `Basic Table`
    → table style); it never overwrites a choice you've already made — review,
    then Save mapping.
  - **Presets** — save the current mapping under a name and load or delete it
    later (e.g. one preset per publication).
- **Markdown coverage**
  - Headings `#`–`######`, plus setext (`===` / `---` underlines)
  - Paragraphs, blockquotes
  - Bulleted / numbered / task lists
  - Fenced code blocks, inline code
  - Bold, italic, bold-italic, strikethrough, highlight
  - Links (turned into live InDesign hyperlinks) and autolinks
  - Tables — apply a native **Table Style** and header/body **Cell Styles**,
    or fall back to paragraph styles; column alignment (`:--` / `:--:` / `--:`)
    is honored either way
  - Horizontal rules
  - Images (rendered as a styled caption in v1 — see *Limitations*)

## Install (development)

1. Install **Adobe UXP Developer Tool (UDT)** from Creative Cloud.
2. Launch InDesign (2023 / v18 or newer).
3. In UDT: **Add Plugin** → select this folder's `manifest.json`.
4. Click **Load**. The panel appears under **Window ▸ Extensions ▸ inDown**.

To package for distribution, use UDT's **Package** action to produce a `.ccx`.

## Usage

1. Open the document whose styles you want to target.
2. Open the inDown panel and click **Style Mapping…**.
3. For each Markdown construct, pick a paragraph or character style (or leave it
   as *(None)* to keep InDesign's default). Click **Refresh** if you add styles
   while the panel is open. Click **Save mapping**.
4. Back on the main view, drop a `.md` file onto the panel — or click **Import
   Markdown File…**.
5. To format Markdown you type directly: click in the text frame and press
   **Format selection**, or flip on **Live auto-format**. **Reveal formatting**
   shows the syntax again in blue; click it again to hide. (Turn Reveal off
   before formatting — the two are mutually exclusive.)

**Where the text lands:** if a text frame (or a text selection) is selected,
content is appended to that story. Otherwise inDown creates a new text frame on
the active page, inset to the page margins.

**Notes on typed-text formatting:** only constructs you've mapped are
converted; unmapped Markdown is left as literal text. Map **Body / paragraph**
so that pressing Return after a heading resets the new line to Body. Reveal
reconstructs headings, lists, blockquotes, and inline bold/italic/code/
strikethrough/highlight; it does not rebuild link URLs, code fences, tables,
or rules.

**Performance:** imports and Format selection run as a single named undo step
(one Cmd+Z reverts the whole import, and InDesign batches recomposition). The
live formatter skips ticks when nothing changed and restricts its work to the
paragraph being typed plus its predecessor, so it stays fast in long stories.

**Export notes:** export is driven by the same style mapping (only mapped
styles round-trip). Tables and placed images are not exported in this
version, and consecutive code-block paragraphs export as one fenced block.

## Limitations (and why)

UXP plugins run in a sandbox and **cannot** hook InDesign's native **File ▸
Place** menu or intercept files dropped directly onto the document canvas —
those hooks are reserved for native C++ SDK plugins. inDown therefore provides
its own equivalents: a panel drop zone and an Import button. (OS-level file drop
onto the panel depends on a recent InDesign/UXP build; the Import button always
works.)

Images are rendered as a styled caption/alt-text paragraph in this version;
actual image placement is planned for a future release.

## Project layout

```
manifest.json            UXP manifest (host "ID", panel entrypoint, permissions)
index.html               Panel markup (import view + settings view)
styles/main.css          Panel styling
main.js                  Whole plugin: parser, style mapping, importer, panel UI
test/parser.test.js      Parser unit checks (run: npm test)
samples/sample.md        Example document
```

`main.js` is a single root file with no cross-file `require`s (UXP loads it as
the panel's root script, where local module resolution is unreliable). The
built-in `uxp` / `indesign` modules are required lazily, so the parser is still
unit-testable in plain Node.

## Develop

The parser is plain JavaScript with no InDesign dependency, so its tests run in
Node:

```
npm test
```

## License

MIT — see [LICENSE](LICENSE).
