const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createLocalStorage() {
  const values = new Map();
  const storage = {
    getItem(key) { key = String(key); return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { key = String(key); value = String(value); values.set(key, value); storage[key] = value; },
    removeItem(key) { key = String(key); values.delete(key); delete storage[key]; },
    clear() { for (const key of values.keys()) delete storage[key]; values.clear(); },
    key(index) { return [...values.keys()][index] ?? null; },
    get length() { return values.size; },
  };
  return storage;
}

function loadModule(relPath, { fetch, RP_LUTS } = {}) {
  const window = {};
  const localStorage = createLocalStorage();
  const sandbox = {
    window,
    localStorage,
    fetch: fetch || (() => { throw new Error("unexpected fetch"); }),
    setTimeout,
    clearTimeout,
    Blob,
    FormData,
    URL,
    atob,
    btoa,
    console,
    TextEncoder,
    Uint8Array,
    Uint32Array,
    ArrayBuffer,
    DataView,
    document: {},
  };
  window.window = window;
  window.localStorage = localStorage;
  window.fetch = sandbox.fetch;
  if (RP_LUTS !== undefined) window.RP_LUTS = RP_LUTS;
  const filename = path.resolve(__dirname, "..", relPath);
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), sandbox, { filename });
  return window;
}

module.exports = { loadModule };
