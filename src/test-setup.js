// Minimal browser shims. Deliberately not jsdom — these tests exercise the
// request layer, not the DOM, and a full DOM implementation is a large dep
// for one Storage object.
class MemoryStorage {
  #m = new Map();
  getItem(k) { return this.#m.has(k) ? this.#m.get(k) : null; }
  setItem(k, v) { this.#m.set(k, String(v)); }
  removeItem(k) { this.#m.delete(k); }
  clear() { this.#m.clear(); }
}
globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
