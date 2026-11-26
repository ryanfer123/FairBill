const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../app.json').expo;
const configure = require('../app.config.js');

const keys = ['FAIRBILL_PLAY_BUILD', 'FAIRBILL_LOCAL_DEV', 'FAIRBILL_CLOUD_BUILD', 'FAIRBILL_SUPABASE_URL',
  'FAIRBILL_SUPABASE_PUBLISHABLE_KEY', 'FAIRBILL_RELEASE_API_URL', 'FAIRBILL_PRIVACY_URL'];

function build(env, input = config) {
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, env);
    return configure({ config: input });
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('Play cannot be configured for local or remote fixture modes', () => {
  for (const mode of [{ FAIRBILL_LOCAL_DEV: '1' }, { FAIRBILL_CLOUD_BUILD: '0' }]) {
    assert.throws(() => build({ FAIRBILL_PLAY_BUILD: '1', ...mode }), /must use the hosted FairBill service/);
  }
});

test('patient build requires hosted credentials and drops inherited local configuration', () => {
  assert.throws(() => build({}), /FAIRBILL_SUPABASE_PUBLISHABLE_KEY/);
  const release = build({
    FAIRBILL_PLAY_BUILD: '1',
    FAIRBILL_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  }, { ...config, extra: { fairbillLocalApi: 'http://127.0.0.1:8765', other: true } });
  assert.equal(release.extra.fairbillLocalApi, undefined);
  assert.equal(release.extra.other, true);
  assert.equal(release.extra.fairbillSupabaseKey, 'sb_publishable_test');
  assert.match(release.extra.fairbillHostedApi, /^https:/);
  assert.equal(release.plugins.find(plugin => plugin[0] === 'expo-build-properties')[1].android.usesCleartextTraffic, false);
});

test('explicit local QA mode never carries patient auth or a hosted origin', () => {
  const local = build({ FAIRBILL_LOCAL_DEV: '1' }, { ...config, extra: {
    fairbillHostedApi: 'https://patient.example', fairbillSupabaseUrl: 'https://example.supabase.co',
    fairbillSupabaseKey: 'sb_publishable_test',
  } });
  assert.equal(local.extra.fairbillLocalApi, 'http://127.0.0.1:8765');
  for (const key of ['fairbillHostedApi', 'fairbillSupabaseUrl', 'fairbillSupabaseKey']) {
    assert.equal(local.extra[key], undefined);
  }
});
