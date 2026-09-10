// Minimal browser shims. Deliberately not jsdom — these tests exercise the
// request layer, not the DOM, and a full DOM implementation is a large dep
// for one Storage object.
// `length` and `key(i)` are part of the Storage interface and are NOT
// optional: lsCache.lsRemoveByPrefix / lsClearAll enumerate storage with them
// to clear by prefix. Without them those functions silently did nothing here,
// so every prefix-based cache invalidation passed its tests without ever
// running — which is exactly the class of bug they exist to catch.
class MemoryStorage {
  #m = new Map();
  getItem(k) { return this.#m.has(k) ? this.#m.get(k) : null; }
  setItem(k, v) { this.#m.set(k, String(v)); }
  removeItem(k) { this.#m.delete(k); }
  clear() { this.#m.clear(); }
  get length() { return this.#m.size; }
  key(i) {
    const keys = [...this.#m.keys()];
    return i >= 0 && i < keys.length ? keys[i] : null;
  }
}
globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
