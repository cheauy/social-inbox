/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const modulePath = process.env.TENH_STORAGE_PGLITE_MODULE;
test('prepared-upload migration: actual SQL atomicity, replay, grants and deleted-file safety', { skip: !modulePath }, async () => {
  const { PGlite } = require(modulePath);
  const db = new PGlite();
  const business = '10000000-0000-4000-8000-000000000001', member = '20000000-0000-4000-8000-000000000001';
  const upload = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.businesses(id uuid primary key);
      create table public.team_members(id uuid primary key, business_id uuid references public.businesses, is_active boolean);
      grant usage on schema public to service_role;
      grant select on public.team_members to service_role;
      create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);
      insert into public.businesses values ('${business}');
      insert into public.team_members values ('${member}','${business}',true);`);
    for (const file of ['20261008_workspace_storage.sql', '20261009_workspace_storage_organization.sql', '20261015065143_workspace_storage_upload_lifecycle.sql']) {
      await db.exec(fs.readFileSync(`db/migrations/${file}`, 'utf8'));
    }
    const prepare = async (n, category = null) => {
      await db.query(`insert into public.workspace_storage_uploads(id,business_id,member_id,storage_path,display_name,mime_type,size_bytes,file_kind,category_id)
        values ($1,$2,$3,$4,'local.pdf','application/pdf',3,'file',$5)`, [upload(n), business, member, `${business}/${upload(n)}-local.pdf`, category]);
    };
    const finalize = n => db.query('select public.finalize_workspace_storage_upload($1,$2,$3) as file', [upload(n), business, member]);
    await prepare(1);
    const first = await finalize(1), second = await finalize(1);
    assert.deepEqual(first.rows, second.rows);
    assert.equal((await db.query('select count(*)::int as n from public.workspace_files')).rows[0].n, 1);
    await prepare(2);
    await db.exec(`create function public.reject_local_insert() returns trigger language plpgsql as $$ begin raise exception 'fixture insert failure'; end $$;
      create trigger reject_local_insert before insert on public.workspace_files for each row execute function public.reject_local_insert();`);
    await assert.rejects(finalize(2), /fixture insert failure/);
    assert.equal((await db.query('select state from public.workspace_storage_uploads where id=$1', [upload(2)])).rows[0].state, 'prepared');
    assert.equal((await db.query('select count(*)::int as n from public.workspace_files')).rows[0].n, 1);
    await db.exec('drop trigger reject_local_insert on public.workspace_files; drop function public.reject_local_insert();');
    await finalize(2);
    await db.query('update public.workspace_files set deleted_at=now() where id=$1', [upload(2)]);
    await assert.rejects(finalize(2), /no longer available/);
    await prepare(3, upload(99));
    await assert.rejects(finalize(3), /category is no longer available/);
    await db.query('update public.workspace_storage_uploads set expires_at=now()-interval \'1 second\' where id=$1', [upload(3)]);
    await assert.rejects(finalize(3), /expired/);
    await db.query('update public.team_members set is_active=false where id=$1', [member]);
    await assert.rejects(finalize(1), /revoked/);
    for (const role of ['anon', 'authenticated']) {
      const permissions = await db.query(`select has_function_privilege($1,'public.finalize_workspace_storage_upload(uuid,uuid,uuid)','EXECUTE') as rpc,
        has_table_privilege($1,'public.workspace_storage_uploads','SELECT') as tickets`, [role]);
      assert.deepEqual(permissions.rows[0], { rpc: false, tickets: false });
    }
    await db.query('update public.team_members set is_active=true where id=$1', [member]);
    await db.exec('set role service_role');
    assert.equal((await finalize(1)).rows[0].file.id, upload(1));
    await db.exec('reset role');
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.workspace_storage_uploads'::regclass")).rows[0].relrowsecurity, true);
  } finally { await db.close(); }
});
