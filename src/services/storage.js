const TOKEN_KEY = 'stuff.googleAccessToken';
const TOKEN_EXPIRY_KEY = 'stuff.googleAccessTokenExpiresAt';
const INVENTORY_KEY = 'stuff.spreadsheetId';
const REMEMBER_KEY = 'stuff.rememberAccess';
const VIEW_KEY = 'stuff.viewMode';
const SNAPSHOT_PREFIX = 'stuff.inventorySnapshot.';
const TOKEN_SAFETY_WINDOW = 60_000;

let memoryToken = '';
let memoryExpiry = 0;

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function readBoolean(key, fallback) {
  const value = storage()?.getItem(key);
  if (value === null || value === undefined) return fallback;
  return value === 'true';
}

export const tokenVault = Object.freeze({
  get() {
    const store = storage();
    const persistedToken = store?.getItem(TOKEN_KEY) || '';
    const persistedExpiry = Number(store?.getItem(TOKEN_EXPIRY_KEY) || 0);
    const token = memoryToken || persistedToken;
    const expiresAt = memoryToken ? memoryExpiry : persistedExpiry;
    if (!token || !expiresAt || Date.now() >= expiresAt - TOKEN_SAFETY_WINDOW) {
      this.clear();
      return '';
    }
    return token;
  },

  set(token, expiresInSeconds, remember = preferences.rememberAccess) {
    this.clear();
    const expiresAt = Date.now() + Math.max(0, Number(expiresInSeconds) || 0) * 1000;
    memoryToken = String(token);
    memoryExpiry = expiresAt;
    if (remember) {
      storage()?.setItem(TOKEN_KEY, memoryToken);
      storage()?.setItem(TOKEN_EXPIRY_KEY, String(expiresAt));
    }
  },

  clear() {
    memoryToken = '';
    memoryExpiry = 0;
    storage()?.removeItem(TOKEN_KEY);
    storage()?.removeItem(TOKEN_EXPIRY_KEY);
  },

  forgetPersisted() {
    storage()?.removeItem(TOKEN_KEY);
    storage()?.removeItem(TOKEN_EXPIRY_KEY);
  },

  rememberCurrent() {
    if (!memoryToken || !memoryExpiry || Date.now() >= memoryExpiry - TOKEN_SAFETY_WINDOW) return;
    storage()?.setItem(TOKEN_KEY, memoryToken);
    storage()?.setItem(TOKEN_EXPIRY_KEY, String(memoryExpiry));
  },

  expiresAt() {
    if (!this.get()) return 0;
    return memoryToken ? memoryExpiry : Number(storage()?.getItem(TOKEN_EXPIRY_KEY) || 0);
  },
});

export const preferences = Object.freeze({
  get rememberAccess() {
    return readBoolean(REMEMBER_KEY, true);
  },
  set rememberAccess(value) {
    storage()?.setItem(REMEMBER_KEY, String(Boolean(value)));
    if (value) tokenVault.rememberCurrent();
    else tokenVault.forgetPersisted();
  },
  get spreadsheetId() {
    return storage()?.getItem(INVENTORY_KEY) || '';
  },
  set spreadsheetId(value) {
    if (value) storage()?.setItem(INVENTORY_KEY, String(value));
    else storage()?.removeItem(INVENTORY_KEY);
  },
  get viewMode() {
    const value = storage()?.getItem(VIEW_KEY);
    return value === 'list' ? 'list' : 'grid';
  },
  set viewMode(value) {
    storage()?.setItem(VIEW_KEY, value === 'list' ? 'list' : 'grid');
  },
  clearConnection() {
    tokenVault.clear();
    this.spreadsheetId = '';
  },
});

export const inventorySnapshotCache = Object.freeze({
  get(spreadsheetId) {
    if (!spreadsheetId) return null;
    try {
      const snapshot = JSON.parse(storage()?.getItem(`${SNAPSHOT_PREFIX}${spreadsheetId}`) || '');
      if (!snapshot || snapshot.version !== 1 || !snapshot.data || !Array.isArray(snapshot.data.items) || !Array.isArray(snapshot.data.places) || !Array.isArray(snapshot.data.photos)) return null;
      return snapshot;
    } catch {
      return null;
    }
  },

  set(database) {
    if (!database?.spreadsheetId || !database?.data) return;
    const snapshot = {
      version: 1,
      savedAt: new Date().toISOString(),
      settings: [...(database.settings || new Map()).entries()],
      data: database.data,
    };
    try {
      storage()?.setItem(`${SNAPSHOT_PREFIX}${database.spreadsheetId}`, JSON.stringify(snapshot));
    } catch {
      // Caching is optional. Browsing the connected inventory remains fully functional.
    }
  },

  clear(spreadsheetId) {
    if (spreadsheetId) storage()?.removeItem(`${SNAPSHOT_PREFIX}${spreadsheetId}`);
  },
});

export const STORAGE_KEYS = Object.freeze({
  TOKEN_KEY,
  TOKEN_EXPIRY_KEY,
  INVENTORY_KEY,
  REMEMBER_KEY,
  VIEW_KEY,
  SNAPSHOT_PREFIX,
});
