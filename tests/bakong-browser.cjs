/* eslint-disable @typescript-eslint/no-require-imports */
process.env.TENH_PAYMENT_BROWSER_MODE = 'bakong';
process.env.TENH_PAYMENT_ATTEMPT_EVIDENCE ||= 'docs/evidence/bakong-20261015/browser';
require('./payment-attempt-browser.cjs');
