import assert from 'node:assert/strict';
import test from 'node:test';

import { isGoogleConfigured } from '../src/config.js';

test('accepts a ten-digit Google Cloud project number', () => {
  assert.equal(isGoogleConfigured({
    clientId: '1564650092-example.apps.googleusercontent.com',
    pickerApiKey: 'AIza-example',
    projectNumber: '1564650092',
  }), true);
});

test('rejects missing and placeholder configuration values', () => {
  assert.equal(isGoogleConfigured({
    clientId: 'REPLACE_CLIENT_ID',
    pickerApiKey: 'AIza-example',
    projectNumber: '1564650092',
  }), false);

  assert.equal(isGoogleConfigured({
    clientId: '1564650092-example.apps.googleusercontent.com',
    pickerApiKey: '',
    projectNumber: '1564650092',
  }), false);
});
