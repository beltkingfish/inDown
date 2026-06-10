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
- **Style mapping window** — scope every Markdown construct to a paragraph or
  character style from the active document. Saved between sessions.
- **Markdown coverage**
  - Headings `#`–`######`, paragraphs, blockquotes
  - Bulleted / numbered / task lists
  - Fenced code blocks, inline code
  - Bold, italic, bold-italic, strikethrough, highlight
  - Links (turned into live InDesign hyperlinks) and autolinks
  - Tables (with header/body cell styles)
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
2. Open the inDown panel and click **Configure styles…**.
3. For each Markdown construct, pick a paragraph or character style (or leave it
   as *(None)* to keep InDesign's default). Click **Refresh** if you add styles
   while the panel is open. Click **Save mapping**.
4. Back on the main view, drop a `.md` file onto the panel — or click **Import
   Markdown File…**.

**Where the text lands:** if a text frame (or a text selection) is selected,
content is appended to that story. Otherwise inDown creates a new text frame on
the active page, inset to the page margins.

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
manifest.json            UXP manifest (host "ID", panel + flyout, permissions)
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
