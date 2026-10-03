const test = require('node:test'), assert = require('node:assert/strict');
const { loader, hooks, tick } = require('./inbox-recovery-harness.cjs');
const baseline = process.env.TENH_READ_AUDIT_BASELINE === '1';

function widget(file, name, visibility = 'visible', fetchResponse) {
  const h = hooks(), intervals = [], timers = new Map(), calls = [];
  const win = new EventTarget(), doc = new EventTarget(); doc.visibilityState = visibility; let id = 0;
  win.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; }; win.clearInterval = () => {};
  win.setTimeout = fn => { timers.set(++id, fn); return id; }; win.clearTimeout = n => timers.delete(n);
  const load = loader({ react: h.React, 'react/jsx-runtime': h.jsx,
    'next/navigation': { useRouter: () => ({}) }, '@/components/display/workspace-language-text': { useWorkspaceLanguageId: () => 'en' },
    '@/lib/supabase/client': { createClient: () => ({ channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {} }) },
    '@/lib/inbox/notification-sounds': { getStoredNotificationVolume: () => 0 },
  }, { window: win, document: doc, Audio: class { addEventListener() {} pause() {} },
    fetch: async url => { calls.push(url); return fetchResponse ? fetchResponse(url) : Response.json({ success: true, notifications: [], memberIds: [], invitations: [], pages: [] }); } });
  const Component = load(file)[name]; h.render(Component, {});
  return { h, calls, win, doc, advanceMinute: () => { for (let ms = 30_000; ms <= 60_000; ms += 30_000) for (const interval of intervals) if (ms % interval.ms === 0) interval.fn(); },
    flush: () => { const work = [...timers.values()]; timers.clear(); work.forEach(fn => fn()); }, timers };
}
for (const [file, name, initial, perMinute] of [
  ['team-notification-center', 'TeamNotificationCenter', 2, 4],
  ['pending-invitations-banner', 'PendingInvitationsBanner', 1, 1],
  ['facebook-connection-attention-banner', 'FacebookConnectionAttentionBanner', 1, 1],
]) {
  test(name + ' preserves required polls, pauses nonessential hidden reads and coalesces recovery', async () => {
    const d = widget(`components/dashboard/${file}.tsx`, name);
    try {
      await tick(); assert.equal(d.calls.length, initial);
      d.doc.visibilityState = 'hidden'; d.advanceMinute(); d.win.dispatchEvent(new Event('focus')); d.flush(); await tick();
      const hidden = d.calls.length - initial;
      if (baseline) { console.log(JSON.stringify({ widget: name, initial, hiddenMinuteReads: hidden, scheduledOnly: perMinute })); assert.ok(hidden >= perMinute); return; }
      assert.equal(hidden, name === 'TeamNotificationCenter' ? 4 : 0, 'notification polling also produces due reminders');
      const beforeResume = d.calls.length;
      d.doc.visibilityState = 'visible'; d.doc.dispatchEvent(new Event('visibilitychange')); d.win.dispatchEvent(new Event('focus')); d.win.dispatchEvent(new Event('online'));
      assert.equal(d.timers.size, 1); d.flush(); await tick(); assert.equal(d.calls.length, beforeResume + initial);
      const resumeReads = d.calls.length - beforeResume, beforeVisible = d.calls.length;
      d.advanceMinute(); await tick(); assert.equal(d.calls.length, beforeVisible + perMinute, 'visible periodic freshness remains');
      console.log(JSON.stringify({ widget:name, hiddenMinuteReads:hidden, coalescedResumeReads:resumeReads, visibleMinuteReads:d.calls.length-beforeVisible }));
      d.doc.visibilityState = 'hidden'; d.doc.dispatchEvent(new Event('visibilitychange')); d.flush(); await tick();
      assert.equal(d.calls.length, beforeVisible + perMinute);
    } finally { d.h.cleanup(); }
  });
}

test('the foreground recovery timer is discarded when hidden or unmounted', async () => {
  if (baseline) return;
  const d = widget('components/dashboard/pending-invitations-banner.tsx', 'PendingInvitationsBanner');
  try {
    await tick(); d.win.dispatchEvent(new Event('focus')); assert.equal(d.timers.size, 1);
    d.doc.visibilityState = 'hidden'; d.doc.dispatchEvent(new Event('visibilitychange')); assert.equal(d.timers.size, 0);
    d.doc.visibilityState = 'visible'; d.doc.dispatchEvent(new Event('visibilitychange')); assert.equal(d.timers.size, 1);
    d.h.cleanup(); assert.equal(d.timers.size, 0); d.flush(); await tick(); assert.equal(d.calls.length, 1);
  } finally { d.h.cleanup(); }
});

test('initially hidden notification polling continues every 30 seconds for reminder production', async () => {
  if (baseline) return;
  const d = widget('components/dashboard/team-notification-center.tsx', 'TeamNotificationCenter', 'hidden');
  try { await tick(); assert.equal(d.calls.length,2); d.advanceMinute(); await tick(); assert.equal(d.calls.length,6); }
  finally { d.h.cleanup(); }
});

test('a reminder becoming due while hidden is materialized by the actual notification GET and producer', async () => {
  if (baseline) return;
  let due = false, reminderChecks = 0;
  const tables = {
    team_members: [{ id:'owner-a', business_id:'a', user_id:'user-a', is_active:true }, { id:'agent-a', business_id:'a', user_id:'user-other', is_active:true }, { id:'outside-b', business_id:'b', user_id:'user-other', is_active:true }],
    business_subscriptions: [], team_notifications: [],
    conversation_reminders: [{ id:'reminder-a', business_id:'a', conversation_id:'conversation-a', contact_id:null, note:'Due while hidden', status:'open', remind_at:new Date(Date.now()-1000).toISOString() }],
  };
  class Query {
    constructor(table) { this.table=table; this.filters=[]; this.max=Infinity; }
    select() { return this; } order() { return this; }
    eq(k,v) { this.filters.push(row=>row[k]===v); return this; }
    neq(k,v) { this.filters.push(row=>row[k]!==v); return this; }
    in(k,v) { this.filters.push(row=>v.includes(row[k])); return this; }
    lte(k,v) { this.filters.push(row=>row[k]<=v); return this; }
    limit(n) { this.max=n; return this; }
    upsert(rows,options) {
      assert.equal(options.ignoreDuplicates,true); assert.equal(options.onConflict,'id');
      for (const row of rows) {
        assert.equal(row.business_id,'a'); assert.ok(['owner-a','agent-a'].includes(row.recipient_member_id));
        if (!tables.team_notifications.some(existing=>existing.id===row.id)) tables.team_notifications.push(row);
      }
      return Promise.resolve({error:null});
    }
    then(resolve,reject) {
      if (this.table==='conversation_reminders') reminderChecks++;
      const rows = this.table==='conversation_reminders' && !due ? [] : tables[this.table];
      return Promise.resolve({data:rows.filter(row=>this.filters.every(fn=>fn(row))).slice(0,this.max),error:null}).then(resolve,reject);
    }
  }
  const route = loader({ '@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'user-a'}}})}})},
    '@/lib/supabase/admin':{supabaseAdmin:{from:table=>new Query(table)}}, 'next/headers':{cookies:async()=>({get:()=>({value:'a'})})},
    '@/lib/auth/get-current-member':{TENH_ACTIVE_BUSINESS_COOKIE:'synthetic-workspace-cookie'},
  })('app/api/team-notifications/route.ts');
  const d = widget('components/dashboard/team-notification-center.tsx','TeamNotificationCenter','visible',
    url => url==='/api/team-notifications' ? route.GET() : Response.json({success:true,announcement:null}));
  try {
    await tick(); assert.equal(reminderChecks,1); assert.equal(tables.team_notifications.length,0);
    due=true; d.doc.visibilityState='hidden'; d.advanceMinute(); await tick();
    assert.equal(reminderChecks,3,'initial GET plus both hidden 30-second polls must run the producer');
    assert.equal(tables.team_notifications.length,2,'owner and agent get one deterministic notification each, without duplicates');
    assert.equal(d.calls.filter(url=>url==='/api/team-notifications').length,3);
  } finally { d.h.cleanup(); }
});
