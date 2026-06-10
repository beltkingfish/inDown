"use strict";

const { entrypoints } = require("uxp");
const storage = require("uxp").storage;

const { parseMarkdown } = require("./markdown/parser.js");
const importer = require("./indesign/importer.js");
const idStyles = require("./indesign/styles.js");
const mappingStore = require("./config/mapping.js");
const { PARAGRAPH_ELEMENTS, CHARACTER_ELEMENTS } = require("./config/elements.js");

let currentMapping = mappingStore.load();
const pickerRefs = { paragraph: {}, character: {} };

function $(id) {
  return document.getElementById(id);
}

function setStatus(msg, kind) {
  const el = $("status");
  if (!el) {
    return;
  }
  el.textContent = msg || "";
  el.className = "status" + (kind ? " " + kind : "");
}

/* ---------------------------------------------------------------- Import */

function runImport(text, name) {
  try {
    if (!idStyles.hasOpenDocument()) {
      setStatus("Open an InDesign document first.", "error");
      return;
    }
    const blocks = parseMarkdown(text);
    if (!blocks.length) {
      setStatus("Nothing to import — the file looks empty.", "error");
      return;
    }
    const res = importer.applyToDocument(blocks, currentMapping, { includeListMarkers: true });
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
    const fs = storage.localFileSystem;
    const file = await fs.getFileForOpening({
      allowMultiple: false,
      types: ["md", "markdown", "txt", "text"]
    });
    if (!file) {
      return; // user cancelled
    }
    const text = await file.read({ format: storage.formats.utf8 });
    runImport(text, file.name);
  } catch (e) {
    setStatus("Could not open file: " + (e && e.message ? e.message : e), "error");
  }
}

function wireDropzone() {
  const dz = $("dropzone");
  if (!dz) {
    return;
  }

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
        }
      }
      if (text != null) {
        runImport(text, name);
      } else {
        setStatus("Couldn’t read the dropped file here — use the Import button.", "error");
      }
    } catch (err) {
      setStatus(
        "Drop failed: " + (err && err.message ? err.message : err) + " — use the Import button.",
        "error"
      );
    }
  });
}

/* -------------------------------------------------------------- Settings */

function showView(which) {
  $("view-import").classList.toggle("hidden", which !== "import");
  $("view-settings").classList.toggle("hidden", which !== "settings");
  if (which === "settings") {
    renderSettings();
  }
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
    if (n === current) {
      it.setAttribute("selected", "");
    }
    menu.appendChild(it);
  });

  if (current) {
    picker.value = current;
  }
  picker._selectedValue = current || "";
  picker.addEventListener("change", (e) => {
    picker._selectedValue = e.target.value || "";
  });

  row.appendChild(picker);
  container.appendChild(row);
  store[key] = picker;
}

function renderSettings() {
  const hasDoc = idStyles.hasOpenDocument();
  $("no-doc").classList.toggle("hidden", hasDoc);

  const paraNames = idStyles.listParagraphStyleNames();
  const charNames = idStyles.listCharacterStyleNames();

  const pl = $("para-list");
  pl.innerHTML = "";
  pickerRefs.paragraph = {};
  PARAGRAPH_ELEMENTS.forEach((el) =>
    makePickerRow(pl, el.label, paraNames, currentMapping.paragraph[el.key], pickerRefs.paragraph, el.key)
  );

  const cl = $("char-list");
  cl.innerHTML = "";
  pickerRefs.character = {};
  CHARACTER_ELEMENTS.forEach((el) =>
    makePickerRow(cl, el.label, charNames, currentMapping.character[el.key], pickerRefs.character, el.key)
  );
}

function readPicker(picker) {
  if (!picker) {
    return "";
  }
  if (picker._selectedValue !== undefined && picker._selectedValue !== null) {
    return picker._selectedValue;
  }
  return picker.value || "";
}

function saveSettings() {
  const m = mappingStore.emptyMapping();
  PARAGRAPH_ELEMENTS.forEach((el) => {
    m.paragraph[el.key] = readPicker(pickerRefs.paragraph[el.key]);
  });
  CHARACTER_ELEMENTS.forEach((el) => {
    m.character[el.key] = readPicker(pickerRefs.character[el.key]);
  });
  currentMapping = m;
  mappingStore.save(m);
  setStatus("Style mapping saved.", "ok");
  showView("import");
}

/* ------------------------------------------------------------------ Init */

function init() {
  if (init._done) {
    return;
  }
  init._done = true;

  $("btn-import").addEventListener("click", importFromPicker);
  $("btn-settings").addEventListener("click", () => showView("settings"));
  $("btn-back").addEventListener("click", () => showView("import"));
  $("btn-save").addEventListener("click", saveSettings);
  $("btn-refresh").addEventListener("click", renderSettings);

  wireDropzone();
  setStatus("Ready. Drop a .md / .txt file above, or click Import.");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

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
        { id: "settings", label: "Configure styles…" }
      ],
      invokeMenu(id) {
        try {
          if (id === "import") {
            importFromPicker();
          } else if (id === "settings") {
            showView("settings");
          }
        } catch (e) {
          /* ignore */
        }
      }
    }
  }
});
