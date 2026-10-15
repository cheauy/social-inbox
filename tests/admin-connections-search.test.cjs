/* eslint-disable @typescript-eslint/no-require-imports -- Node fixture uses the CommonJS route harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./tenh-seven/harness.cjs');

const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const account = (number, extra = {}) => ({
  id: id(number), business_id: 'workspace-a', platform: number % 2 ? 'telegram' : 'facebook',
  account_name: `Channel ${number}`, platform_account_id: String(10000 + number), telegram_bot_username: `bot_${number}`,
  is_active: true, telegram_token_status: 'verified', facebook_token_status: 'verified',
  facebook_token_last_error: null, telegram_bot_token_encrypted: 'CIPHERTEXT_DO_NOT_EXPOSE',
  telegram_webhook_status: 'registered', telegram_webhook_url: null, telegram_webhook_registered_at: null,
  telegram_connected_at: null, created_at: '2026-10-15T00:00:00Z', ...extra,
});
const regexEscape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function ilike(value, pattern) {
  pattern = pattern.replace(/\*/g, '%'); // PostgREST aliases '*' to '%' even in quoted LIKE operands.
  let expression = '';
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    expression += character === '\\' && index + 1 < pattern.length ? regexEscape(pattern[++index])
      : character === '%' ? '.*' : character === '_' ? '.' : regexEscape(character);
  }
  return value != null && new RegExp(`^${expression}$`, 'iu').test(String(value));
}
function matchesPattern(value, operator, pattern) {
  return operator === 'imatch' ? value != null && new RegExp(pattern, 'iu').test(String(value)) : ilike(value, pattern);
}
function clauses(expression) {
  const result = []; let depth = 0, quoted = false, escaped = false, start = 0;
  for (let index = 0; index < expression.length; index++) {
    const character = expression[index];
    if (escaped) { escaped = false; continue; }
    if (character === '\\' && quoted) { escaped = true; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (character === '(') depth++;
    if (character === ')') depth--;
    if (character === ',' && depth === 0) { result.push(expression.slice(start, index)); start = index + 1; }
  }
  assert.equal(depth, 0); assert.equal(quoted, false); result.push(expression.slice(start)); return result;
}
function fixture(options = {}) {
  const rows = options.rows ?? [], businesses = options.businesses ?? [{ id: 'workspace-a', name: 'Default Workspace' }], calls = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.logic = []; this.orders = []; this.start = 0; this.end = Infinity; this.embedded = new Map(); }
    select(columns) { this.columns = columns; return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
    ilike(key, value) { return this.filter(key, 'ilike', value); }
    filter(key, operator, value) { this.embedded.set(key, { operator, value }); return this; }
    or(expression) { this.logic.push(expression); return this; }
    order(key, config) { this.orders.push([key, config]); return this; }
    range(start, end) { this.start = start; this.end = end; return this; }
    limit(count) { this.end = count - 1; return this; }
    matches(expression, row) {
      for (const operation of ['and', 'or']) if (expression.startsWith(`${operation}(`)) {
        const children = clauses(expression.slice(operation.length + 1, -1));
        return operation === 'and' ? children.every(child => this.matches(child, row)) : children.some(child => this.matches(child, row));
      }
      const match = /^([a-z_]+)\.(not\.is|eq|neq|is|ilike|imatch)\.(.*)$/.exec(expression); assert.ok(match, expression);
      const [, key, operation, raw] = match; const expected = raw.startsWith('"') ? JSON.parse(raw) : raw;
      const business = businesses.find(item => item.id === row.business_id);
      const embedded = this.embedded.get('business_match.name');
      const value = key === 'business_match' ? (business && embedded && matchesPattern(business.name, embedded.operator, embedded.value) ? business : null) : row[key];
      if (operation === 'not.is') return value != null;
      if (operation === 'is') return expected === 'null' && value == null;
      if (operation === 'ilike' || operation === 'imatch') return matchesPattern(value, operation, expected);
      if (operation === 'neq') return value != null && value !== expected;
      return value === expected;
    }
    then(resolve, reject) { return Promise.resolve().then(() => {
      calls.push({ table: this.table, columns: this.columns, range: [this.start, this.end], logic: this.logic, embedded: this.embedded, orders: this.orders });
      if (options.databaseError) return { data: null, error: { message: 'Mock read failure' } };
      let found = (this.table === 'social_accounts' ? rows : businesses).filter(row => this.filters.every(filter => filter(row)) && this.logic.every(expression => clauses(expression).some(clause => this.matches(clause, row))));
      found = [...found].sort((left, right) => {
        for (const [key, config] of this.orders) {
          if (left[key] === right[key]) continue;
          if (left[key] == null || right[key] == null) return left[key] == null ? (config.nullsFirst ? -1 : 1) : (config.nullsFirst ? 1 : -1);
          return (left[key] < right[key] ? -1 : 1) * (config.ascending ? 1 : -1);
        }
        return 0;
      }).slice(this.start, this.end + 1);
      return { data: found.map(row => ({ ...row, business: businesses.find(item => item.id === row.business_id) ?? null })), error: null };
    }).then(resolve, reject); }
  }
  const route = loader({
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/admin/tenh-admin-auth': { getTenhAdminUser: async () => options.authStatus ? { success: false, status: options.authStatus, error: 'Admin access denied' } : { success: true, user: { id: 'admin' } } },
    '@/lib/supabase/admin': { supabaseAdmin: { from: table => new Query(table) } },
    '@/lib/admin/log-tenh-admin-action': { logTenhAdminAction: () => { throw new Error('No audit mutation during GET'); } },
    '@/lib/channels/channel-token-crypto': { decryptChannelCredential: () => { throw new Error('No credential decryption during GET'); } },
    '@/lib/telegram/telegram-api': { deleteTelegramWebhook: () => { throw new Error('No provider mutation during GET'); } },
  })('app/api/tenh-admin/connections/route.ts');
  const get = async (params = { paged: 'true' }) => {
    const response = await route.GET({ nextUrl: new URL(`https://app.tenhchat.com/api/tenh-admin/connections?${new URLSearchParams(params)}`) });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, ...await response.json() };
  };
  return { get, calls };
}

test('paged connection search preserves the full admin auth gate before database reads', async () => {
  for (const authStatus of [401, 403]) {
    const f = fixture({ authStatus }); assert.equal((await f.get()).status, authStatus); assert.deepEqual(f.calls, []);
  }
});

test('bounded combined pages traverse more than 200 tied connections without missing or duplicate IDs', async () => {
  const rows = Array.from({ length: 245 }, (_, index) => account(index + 1)); const f = fixture({ rows });
  const collected = []; let offset = 0;
  do {
    const result = await f.get({ paged: 'true', limit: '50', offset: String(offset) }); assert.equal(result.status, 200);
    collected.push(...result.items.map(item => item.connection.connectionId)); offset = result.nextOffset;
    assert.equal(result.hasMore, offset !== null); assert.ok(result.items.every(item => ['telegram', 'messenger'].includes(item.kind)));
    assert.ok(!JSON.stringify(result).includes('CIPHERTEXT_DO_NOT_EXPOSE')); assert.ok(!JSON.stringify(result).includes('telegram_bot_token_encrypted'));
  } while (offset !== null);
  assert.deepEqual(collected, rows.map(row => row.id)); assert.equal(new Set(collected).size, 245);
  assert.ok(f.calls.every(call => call.table === 'social_accounts' && call.range[1] - call.range[0] === 50));
  assert.ok(f.calls.every(call => call.orders.map(order => order[0]).join(',') === 'created_at,id'));
});

test('business-name, Khmer and NFC case-insensitive searches apply across the full dataset before pagination', async () => {
  const rows = Array.from({ length: 220 }, (_, index) => account(index + 1)); rows.push(account(221, { business_id: 'khmer' }), account(222, { business_id: 'accent' }));
  const f = fixture({ rows, businesses: [{ id: 'workspace-a', name: 'Default Workspace' }, { id: 'khmer', name: 'ហាងកម្ពុជា' }, { id: 'accent', name: 'Café Store' }] });
  const khmer = await f.get({ paged: 'true', query: 'កម្ពុជា', limit: '1' }); assert.deepEqual(khmer.items.map(item => item.connection.connectionId), [id(221)]); assert.equal(khmer.items[0].connection.businessName, 'ហាងកម្ពុជា');
  const accent = await f.get({ paged: 'true', query: '  CAFE\u0301  ' }); assert.equal(accent.query, 'café'); assert.deepEqual(accent.items.map(item => item.connection.connectionId), [id(222)]);
  assert.ok(f.calls.every(call => call.columns.includes('business:businesses(name),business_match:businesses()')));
  assert.ok(f.calls.every(call => call.logic.some(expression => expression.includes('business_match.not.is.null'))));
});

test('literal punctuation, row fields, @username and UUID IDs remain searchable without losing business labels', async () => {
  const name = 'Acme,(Owner)*50%_\\ "Blue"'; const own = account(1, { account_name: name, business_id: id(500) });
  const f = fixture({ rows: [own, account(2, { telegram_bot_username: 'bot_1' })], businesses: [{ id: id(500), name: 'Unrelated business name' }, { id: 'workspace-a', name: 'Default Workspace' }] });
  for (const query of [name, '@BOT_1', '10001', own.id, own.business_id]) {
    const result = await f.get({ paged: 'true', query }); assert.deepEqual(result.items.map(item => item.connection.connectionId), [own.id]); assert.equal(result.items[0].connection.businessName, 'Unrelated business name');
  }
});

test('released visibility and platform filters apply before pagination with the existing null-status rules', async () => {
  const rows = [account(1, { telegram_token_status: 'pending' }), account(2, { facebook_token_status: 'disconnected' }), account(3, { is_active: false }), account(4, { facebook_token_status: null }), account(5, { telegram_token_status: null }), account(6)];
  const f = fixture({ rows });
  assert.deepEqual((await f.get()).items.map(item => item.connection.connectionId), [id(3), id(4), id(6)]);
  assert.deepEqual((await f.get({ paged: 'true', includeReleased: 'true' })).items.map(item => item.connection.connectionId), rows.map(row => row.id));
  assert.deepEqual((await f.get({ paged: 'true', platform: 'telegram' })).items.map(item => item.connection.connectionId), [id(3)]);
  assert.deepEqual((await f.get({ paged: 'true', platform: 'messenger', limit: '1', offset: '1' })).items.map(item => item.connection.connectionId), [id(6)]);
  const empty = await f.get({ paged: 'true', query: 'unmatched' }); assert.deepEqual(empty.items, []); assert.equal(empty.hasMore, false); assert.equal(empty.nextOffset, null);
});

test('a literal asterisk never expands to unrelated connections or business names', async () => {
  const f = fixture({ rows: [account(1), account(2)] });
  const result = await f.get({ paged: 'true', query: '*' });
  assert.deepEqual(result.items, []); assert.equal(result.hasMore, false); assert.equal(result.nextOffset, null);
});

test('literal asterisks match only exact name, business, username and ID text', async () => {
  const rows = [account(1, { account_name: 'Store* Alpha' }), account(2, { account_name: 'Storefront Alpha' }),
    account(3, { business_id: 'star-business' }), account(4, { business_id: 'other-business' }),
    account(5, { telegram_bot_username: 'exact*bot' }), account(6, { platform_account_id: '12*34' }), account(7, { platform_account_id: '1234' })];
  const f = fixture({ rows, businesses: [{ id: 'workspace-a', name: 'Default Workspace' }, { id: 'star-business', name: 'Bright* Labs' }, { id: 'other-business', name: 'Bright Horizon Labs' }] });
  for (const [query, expected] of [['Store*', 1], ['Bright*', 3], ['@exact*bot', 5], ['12*34', 6]]) {
    const result = await f.get({ paged: 'true', query }); assert.deepEqual(result.items.map(item => item.connection.connectionId), [id(expected)]);
  }
  assert.deepEqual((await f.get({ paged: 'true', query: '*' })).items.map(item => item.connection.connectionId), [id(1), id(3), id(5), id(6)]);
});

test('invalid pagination rejects without reads, database failures fail closed, and legacy GET keeps its 200-per-platform contract', async () => {
  const f = fixture();
  for (const params of [{ limit: '0' }, { limit: '101' }, { limit: '1.5' }, { offset: '-1' }, { offset: 'Infinity' }]) assert.equal((await f.get({ paged: 'true', ...params })).status, 400);
  assert.deepEqual(f.calls, []); assert.equal((await fixture({ databaseError: true }).get()).status, 500);
  const legacy = fixture({ rows: Array.from({ length: 430 }, (_, index) => account(index + 1)) }); const result = await legacy.get({});
  assert.equal(result.status, 200); assert.equal(result.telegram.length, 200); assert.equal(result.messenger.length, 200); assert.equal(result.items, undefined);
});
