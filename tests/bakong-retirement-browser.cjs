/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TENH_PAYMENT_BROWSER_MODE = 'retirement';
process.env.TENH_PAYMENT_ATTEMPT_EVIDENCE ||= 'docs/evidence/bakong-retirement-20261017/browser';
require('./payment-attempt-browser.cjs');
