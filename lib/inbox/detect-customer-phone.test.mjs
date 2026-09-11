import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCustomerPhone } from './detect-customer-phone.ts';

test('detects Cambodian, Khmer digit and international phone numbers',()=>{
 for(const [text,wanted] of [
  ['012 345 678','+85512345678'],
  ['0979055552','+855979055552'],
  ['My phone is 096-123-4567','+855961234567'],
  ['លេខទូរស័ព្ទ ០១២ ៣៤៥ ៦៧៨','+85512345678'],
  ['លេខទូរស័ព្ទ០១២៣៤៥៦៧៨','+85512345678'],
  ['Call +855 12 345 678 please','+85512345678'],
  ['Call +1 (202) 555-0123','+12025550123'],
  ['０１２３４５６７８','+85512345678'],
 ])assert.equal(detectCustomerPhone(text),wanted,text);
});
test('does not turn prices, dates, order IDs, URLs or short codes into phone numbers',()=>{
 for(const text of ['12345','2026-09-11','order #012345678','Tracking: 012345678','OTP 012345678','$012345678','Price: 012345678','https://example.com/012345678','phone012345678@example.com','AB012345678','hello',null])assert.equal(detectCustomerPhone(text),null,text);
});
test('requires one distinct number but accepts the same phone repeated',()=>{
 assert.equal(detectCustomerPhone('012345678 or 0961234567'),null);
 assert.equal(detectCustomerPhone('012345678, also +85512345678'),'+85512345678');
});
