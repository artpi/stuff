export const APP_VERSION = '0.1.7';

// These three browser-visible identifiers are intentionally public. Replace the
// placeholders after creating the Google Cloud project described in README.md.
export const GOOGLE_CONFIG = Object.freeze({
  clientId: '1564650092-38icb6i2fbiqfkq1g66g9gquqva2s1ub.apps.googleusercontent.com',
  pickerApiKey: 'AIzaSyDZrF8EspMxmcqrDuMVXCjVEs1Lnpm6eZI',
  projectNumber: '1564650092',
});

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const LOCAL_ORIGIN = 'http://localhost:4173';
export const PRODUCTION_ORIGIN = 'https://stuff.piszek.com';

export function isGoogleConfigured(config = GOOGLE_CONFIG) {
  return ['clientId', 'pickerApiKey', 'projectNumber'].every((key) => {
    const value = config[key];
    return typeof value === 'string' && value.trim() !== '' && !value.startsWith('REPLACE_');
  });
}
