export function createMockKv(initialEntries = {}) {
  const store = new Map();
  const puts = [];
  const deletes = [];

  for (const [key, value] of Object.entries(initialEntries)) {
    store.set(key, serialize(value));
  }

  return {
    puts,
    deletes,
    async get(key, options) {
      const value = store.get(key);
      if (value === undefined) return null;
      if (options?.type === "json") {
        return JSON.parse(value);
      }
      return value;
    },
    async put(key, value, options = {}) {
      puts.push({ key, value, options });
      store.set(key, serialize(value));
    },
    async delete(key) {
      deletes.push(key);
      store.delete(key);
    },
    async list(options = {}) {
      const prefix = options.prefix || "";
      const limit = options.limit || 1000;
      const offset = options.cursor ? Number(options.cursor) : 0;
      const allKeys = [...store.keys()].filter((key) => key.startsWith(prefix));
      const keys = allKeys
        .slice(offset, offset + limit)
        .map((name) => ({ name }));
      const nextOffset = offset + keys.length;
      return {
        keys,
        complete: nextOffset >= allKeys.length,
        cursor: nextOffset < allKeys.length ? String(nextOffset) : undefined
      };
    },
    dump() {
      return Object.fromEntries(store);
    }
  };
}

function serialize(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}
