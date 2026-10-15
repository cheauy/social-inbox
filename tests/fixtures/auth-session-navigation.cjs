/* eslint-disable @typescript-eslint/no-require-imports -- Isolate hard reloads while testing the real cleanup and guard. */
module.exports = { ...require('../../lib/auth/browser-session.ts'), reloadForSessionChange() { window.fixtureSessionReloads++; } };
