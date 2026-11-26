import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(process.env.FAIRBILL_SQL_TEST_TOOLS ?? '.', 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const caseId = '00000000-0000-4000-8000-000000000003';
const snapshot = { sample: false, revision: 4, investigated_revision: 4, marker: 'pinned' };
const read = async (sql, parameters = []) => (await db.query(sql, parameters)).rows[0]?.value;
const migration = async (name) => db.exec(await readFile(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'));
const issue = (hash, key) => read('select public.fairbill_create_report_link($1,$2,4,1,$3,$4) as value',
  [owner, caseId, key, hash]);
const download = (hash, check = false) => read('select public.fairbill_resolve_report_link($1,$2) as value', [hash, check]);

try {
  // Minimal Supabase primitives for isolated execution. No network or cloud credentials.
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key, user_id uuid not null, not_after timestamptz);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key, bucket_id text, name text);
    create function storage.foldername(name text) returns text[] language sql as 'select string_to_array(name, ''/'')';
  `);
  await migration('20261124121755_fairbill_private_accounts_and_storage');
  await migration('20261124122735_fairbill_hosted_workflow');
  await db.exec('create table fairbill_private.expired_originals(case_id uuid primary key, owner_id uuid not null)');
  await migration('20261126090612_fairbill_delete_case');
  await migration('20261126180000_fairbill_report_links');

  assert.equal(await read("select public as value from storage.buckets where id='fairbill-originals'"), false);
  assert.equal(await read("select relrowsecurity as value from pg_class where oid='fairbill_private.report_links'::regclass"), true);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(await read("select has_table_privilege($1,'fairbill_private.report_links','select') as value", [role]), false);
    for (const signature of ['fairbill_create_report_link(uuid,uuid,integer,integer,text,text)',
      'fairbill_list_report_links(uuid,uuid)', 'fairbill_revoke_report_link(uuid,uuid,uuid)', 'fairbill_resolve_report_link(text,boolean)']) {
      assert.equal(await read("select has_function_privilege($1,$2,'execute') as value", [role, 'public.' + signature]), role === 'service_role');
    }
  }
  await db.query('insert into auth.users(id) values ($1),($2)', [owner, other]);
  async function resetCase() {
    await db.query('insert into public.fairbill_cases(id,owner_id,serial,snapshot) values ($1,$2,2,$3)', [caseId, owner, snapshot]);
    await db.query("insert into public.fairbill_case_snapshots values ($1,2,'investigate',$2)", [caseId, snapshot]);
  }
  await resetCase();

  const firstHash = 'a'.repeat(64), secondHash = 'b'.repeat(64), thirdHash = 'c'.repeat(64);
  await db.exec('set role service_role');
  assert.equal(await download(firstHash), null);
  const created = await issue(firstHash, 'one');
  assert.equal(created.status, 'ok');
  assert.equal(created.link.status, 'active');
  assert(!('token_hash' in created.link));
  assert.equal((await issue(secondHash, 'one')).status, 'key_conflict');
  assert.equal((await read('select public.fairbill_list_report_links($1,$2) as value', [other, caseId])).status, 'missing');
  assert.equal(await read('select public.fairbill_revoke_report_link($1,$2,$3) as value', [other, caseId, created.link.id]), false);
  assert.deepEqual(await download(firstHash), snapshot);
  assert.equal(await download(firstHash, true), true);
  await db.exec('reset role');

  await db.query("update public.fairbill_cases set serial=3,snapshot=jsonb_set(snapshot,'{marker}','\"unrelated\"') where id=$1", [caseId]);
  assert.deepEqual(await download(firstHash), snapshot);
  assert.equal(await read('select public.fairbill_revoke_report_link($1,$2,$3) as value', [owner, caseId, created.link.id]), true);
  assert.equal(await download(firstHash), null);
  await db.query("update public.fairbill_cases set serial=2,snapshot=$2 where id=$1", [caseId, snapshot]);
  assert.equal((await issue(secondHash, 'two')).status, 'ok');
  await db.query("update fairbill_private.report_links set expires_at=clock_timestamp() where token_hash=$1", [secondHash]);
  assert.equal(await download(secondHash), null);
  assert.equal((await issue(thirdHash, 'three')).status, 'ok');
  await db.query("update public.fairbill_cases set snapshot=jsonb_set(snapshot,'{revision}','5') where id=$1", [caseId]);
  assert.equal(await download(thirdHash), null);
  await db.query("update public.fairbill_cases set snapshot=$2 where id=$1", [caseId, snapshot]);
  assert.deepEqual(await download(thirdHash), snapshot);
  await read('select public.fairbill_delete_case($1,$2) as value', [owner, caseId]);
  assert.equal(await download(thirdHash), null);
  assert.equal(await read('select count(*)::integer as value from fairbill_private.report_links'), 0);

  await resetCase();
  assert.equal((await issue(firstHash, 'account-cleanup')).status, 'ok');
  await read('select public.fairbill_account_originals_for_deletion($1) as value', [owner]);
  assert.equal(await download(firstHash), null);
  assert.equal(await read('select count(*)::integer as value from fairbill_private.report_links'), 0);
  assert.equal((await issue(secondHash, 'inactive')).status, 'inactive');
  console.log('PostgreSQL migration, function grants, RLS, private bucket, revision pinning, expiry, revocation, and deletion passed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
