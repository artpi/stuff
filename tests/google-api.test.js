import test from 'node:test';
import assert from 'node:assert/strict';

import { GoogleApiClient, GoogleApiError } from '../src/services/google-api.js';

test('sends bearer access only as an Authorization header', async () => {
  const originalFetch = globalThis.fetch;
  let observed;
  globalThis.fetch = async (url, options) => {
    observed = { url: String(url), options };
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const client = new GoogleApiClient({ getAccessToken: () => 'secret-token' });
    assert.deepEqual(await client.request('https://www.googleapis.com/drive/v3/about', { query: { fields: 'user' } }), { ok: true });
    assert.equal(observed.url.includes('secret-token'), false);
    assert.equal(new Headers(observed.options.headers).get('Authorization'), 'Bearer secret-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('classifies 401 responses and invokes credential clearing', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Invalid Credentials' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  let cleared = false;
  try {
    const client = new GoogleApiClient({ getAccessToken: () => 'expired', onAuthorizationError: () => { cleared = true; } });
    await assert.rejects(client.request('https://www.googleapis.com/drive/v3/about'), (error) => {
      assert.equal(error instanceof GoogleApiError, true);
      assert.equal(error.reason, 'authorization_expired');
      return true;
    });
    assert.equal(cleared, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
