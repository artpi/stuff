import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

test('keeps only dedicated token keys and can forget persistence without ending the current tab session', async () => {
  globalThis.localStorage = new MemoryStorage();
  const { tokenVault, preferences, STORAGE_KEYS } = await import(`../src/services/storage.js?storage=${Date.now()}`);
  tokenVault.set('temporary-token', 3600, true);
  assert.equal(tokenVault.get(), 'temporary-token');
  assert.equal(globalThis.localStorage.getItem(STORAGE_KEYS.TOKEN_KEY), 'temporary-token');
  preferences.rememberAccess = false;
  assert.equal(tokenVault.get(), 'temporary-token');
  assert.equal(globalThis.localStorage.getItem(STORAGE_KEYS.TOKEN_KEY), null);
  assert.equal(globalThis.localStorage.getItem(STORAGE_KEYS.TOKEN_EXPIRY_KEY), null);
  assert.deepEqual([...globalThis.localStorage.values.keys()], [STORAGE_KEYS.REMEMBER_KEY]);
  tokenVault.clear();
  delete globalThis.localStorage;
});

test('removes tokens inside the sixty-second expiration safety window', async () => {
  globalThis.localStorage = new MemoryStorage();
  const { tokenVault, STORAGE_KEYS } = await import(`../src/services/storage.js?expiry=${Date.now()}`);
  tokenVault.set('almost-expired', 30, true);
  assert.equal(tokenVault.get(), '');
  assert.equal(globalThis.localStorage.getItem(STORAGE_KEYS.TOKEN_KEY), null);
  delete globalThis.localStorage;
});
