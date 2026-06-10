"use strict";

const { PARAGRAPH_ELEMENTS, CHARACTER_ELEMENTS } = require("./elements.js");

const STORAGE_KEY = "indown.styleMapping.v1";

/*
 * The mapping is a plain object of the shape:
 *   { paragraph: { h1: "Heading 1", ... }, character: { bold: "Bold", ... } }
 * An empty string means "no style mapped" (the importer leaves InDesign's
 * default styling in place for that construct).
 *
 * Persistence uses UXP's localStorage when available, with an in-memory
 * fallback so the plugin still works if storage is unavailable.
 */

let memory = null;

function getStore() {
  try {
    if (typeof localStorage !== "undefined" && localStorage) {
      return localStorage;
    }
  } catch (e) {
    /* localStorage not available in this context */
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

function load() {
  const base = emptyMapping();
  let raw = null;
  const store = getStore();
  try {
    raw = store ? store.getItem(STORAGE_KEY) : memory;
  } catch (e) {
    raw = memory;
  }
  if (!raw) {
    return base;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.paragraph) {
      Object.assign(base.paragraph, parsed.paragraph);
    }
    if (parsed && parsed.character) {
      Object.assign(base.character, parsed.character);
    }
  } catch (e) {
    /* corrupt value – fall back to empty mapping */
  }
  return base;
}

function save(mapping) {
  const raw = JSON.stringify(mapping);
  const store = getStore();
  try {
    if (store) {
      store.setItem(STORAGE_KEY, raw);
    } else {
      memory = raw;
    }
  } catch (e) {
    memory = raw;
  }
}

module.exports = { load, save, emptyMapping, STORAGE_KEY };
