import test from 'node:test';
import assert from 'node:assert/strict';

test('silent reconnection requests a token without opening a Google prompt', async () => {
  let requestedPrompt;
  globalThis.google = {
    accounts: {
      oauth2: {
        initTokenClient(config) {
          return {
            requestAccessToken({ prompt }) {
              requestedPrompt = prompt;
              config.callback({ access_token: 'fresh-token', expires_in: 3600 });
            },
          };
        },
      },
    },
  };
  globalThis.localStorage = new MapStorage();
  const { GoogleAuthService } = await import(`../src/services/google-auth.js?silent=${Date.now()}`);

  assert.equal(await new GoogleAuthService().reconnectSilently(), true);
  assert.equal(requestedPrompt, 'none');

  delete globalThis.google;
  delete globalThis.localStorage;
});

test('silent reconnection leaves cached browsing available when Google cannot renew', async () => {
  globalThis.google = {
    accounts: {
      oauth2: {
        initTokenClient(config) {
          return {
            requestAccessToken() {
              config.callback({ error: 'login_required', error_description: 'Sign in is required.' });
            },
          };
        },
      },
    },
  };
  globalThis.localStorage = new MapStorage();
  const { GoogleAuthService } = await import(`../src/services/google-auth.js?failure=${Date.now()}`);

  assert.equal(await new GoogleAuthService().reconnectSilently(), false);

  delete globalThis.google;
  delete globalThis.localStorage;
});

class MapStorage {
  #values = new Map();
  getItem(key) { return this.#values.get(key) || null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
  removeItem(key) { this.#values.delete(key); }
}
