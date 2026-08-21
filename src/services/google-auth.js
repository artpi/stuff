import { GOOGLE_CONFIG, GOOGLE_SCOPE } from '../config.js';
import { tokenVault } from './storage.js';

function waitForGoogleIdentity(timeout = 15_000) {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (globalThis.google?.accounts?.oauth2) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeout) {
        reject(new Error('Google Identity Services did not load. Check content blockers and your connection.'));
        return;
      }
      globalThis.setTimeout(check, 100);
    };
    check();
  });
}

export class GoogleAuthService extends EventTarget {
  #tokenClient = null;
  #pending = null;

  get connected() {
    return Boolean(tokenVault.get());
  }

  async connect({ prompt = 'consent', remember = true } = {}) {
    await waitForGoogleIdentity();
    if (this.#pending) return this.#pending.promise;

    let resolvePending;
    let rejectPending;
    const promise = new Promise((resolve, reject) => {
      resolvePending = resolve;
      rejectPending = reject;
    });
    this.#pending = { promise, resolve: resolvePending, reject: rejectPending };

    const callback = (response) => {
      const pending = this.#pending;
      this.#pending = null;
      if (!pending) return;
      if (response.error) {
        pending.reject(new Error(response.error_description || response.error));
        return;
      }
      tokenVault.set(response.access_token, response.expires_in, remember);
      this.dispatchEvent(new Event('connected'));
      pending.resolve({ expiresAt: tokenVault.expiresAt() });
    };

    if (!this.#tokenClient) {
      this.#tokenClient = globalThis.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CONFIG.clientId,
        scope: GOOGLE_SCOPE,
        callback,
        error_callback: (error) => {
          const pending = this.#pending;
          this.#pending = null;
          pending?.reject(new Error(error?.message || error?.type || 'Google authorization was canceled.'));
        },
      });
    } else {
      this.#tokenClient.callback = callback;
    }

    this.#tokenClient.requestAccessToken({ prompt });
    return promise;
  }

  async reconnectSilently({ remember = true } = {}) {
    try {
      await this.connect({ prompt: 'none', remember });
      return true;
    } catch {
      // Google returns an error instead of displaying UI when a silent request
      // cannot be completed. The caller can keep cached data available.
      return false;
    }
  }

  disconnect() {
    tokenVault.clear();
    this.dispatchEvent(new Event('disconnected'));
  }

  async revoke() {
    const token = tokenVault.get();
    if (!token) {
      this.disconnect();
      return;
    }
    await waitForGoogleIdentity();
    await new Promise((resolve) => globalThis.google.accounts.oauth2.revoke(token, resolve));
    this.disconnect();
  }
}
