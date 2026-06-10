"use strict";

/*
 * Thin helpers over the InDesign DOM for reading and resolving styles.
 * `require("indesign")` is loaded lazily so that the surrounding modules can
 * still be imported in a non-InDesign context (e.g. unit tests of the parser).
 */

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

function activeDocument() {
  return getApp().activeDocument;
}

function collectNames(collection) {
  const out = [];
  try {
    for (let i = 0; i < collection.length; i++) {
      out.push(collection[i].name);
    }
  } catch (e) {
    /* ignore */
  }
  return out;
}

function listParagraphStyleNames() {
  if (!hasOpenDocument()) {
    return [];
  }
  return collectNames(activeDocument().allParagraphStyles);
}

function listCharacterStyleNames() {
  if (!hasOpenDocument()) {
    return [];
  }
  return collectNames(activeDocument().allCharacterStyles);
}

function resolveByName(collection, name) {
  if (!name) {
    return null;
  }
  try {
    for (let i = 0; i < collection.length; i++) {
      if (collection[i].name === name) {
        return collection[i];
      }
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

function resolveParagraphStyle(doc, name) {
  if (!name) {
    return null;
  }
  return resolveByName(doc.allParagraphStyles, name);
}

function resolveCharacterStyle(doc, name) {
  if (!name) {
    return null;
  }
  return resolveByName(doc.allCharacterStyles, name);
}

module.exports = {
  getApp: getApp,
  hasOpenDocument: hasOpenDocument,
  activeDocument: activeDocument,
  listParagraphStyleNames: listParagraphStyleNames,
  listCharacterStyleNames: listCharacterStyleNames,
  resolveParagraphStyle: resolveParagraphStyle,
  resolveCharacterStyle: resolveCharacterStyle
};
