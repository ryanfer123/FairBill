const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadAuth(fetch) {
  const source = fs.readFileSync(path.join(__dirname, '../src/cloud-auth.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const values = new Map();
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, fetch, Headers, AbortController, setTimeout, clearTimeout,
    require(name) {
      if (name === 'expo-constants') {
        return { default: { expoConfig: { extra: {
          fairbillSupabaseUrl: 'https://mock-auth.invalid', fairbillSupabaseKey: 'fictional-publishable-key',
        } } } };
      }
      if (name === 'expo-secure-store') return {
        getItemAsync: async key => values.get(key),
        setItemAsync: async (key, value) => values.set(key, value),
        deleteItemAsync: async key => values.delete(key),
      };
      if (name === 'expo-linking' || name === 'expo-crypto') return {};
      assert.fail(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}

test('a failed profile save keeps the session and a retry publishes the confirmed fields', async () => {
  const user = { id: 'fictional-account', email: 'profile@example.invalid', user_metadata: { display_name: 'Before' } };
  const input = { name: '  Fictional Name  ', state: ' Maharashtra ', evidence: 'settlement' };
  let attempts = 0;
  const auth = loadAuth(async (url, request) => {
    if (url.endsWith('/verify')) {
      return Response.json({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, user });
    }
    assert.equal(url, 'https://mock-auth.invalid/auth/v1/user');
    assert.equal(request.method, 'PUT');
    assert.equal(request.headers.get('Authorization'), 'Bearer test-access');
    const { data } = JSON.parse(request.body);
    assert.deepEqual(data, {
      display_name: 'Fictional Name', home_state: 'Maharashtra', preferred_evidence: 'settlement',
    });
    if (++attempts === 1) throw new Error('Offline');
    return Response.json({ ...user, user_metadata: data });
  });

  await auth.verifySignInCode(user.email, '246810');
  await assert.rejects(auth.updateProfile(input), /Check your connection and retry/);
  assert.equal(auth.accountState(), 'signed-in');
  assert.equal(auth.accountUser().user_metadata.display_name, 'Before');
  await auth.updateProfile(input);
  assert.equal(auth.accountUser().user_metadata.display_name, 'Fictional Name');
  assert.equal(auth.accountUser().user_metadata.preferred_evidence, 'settlement');
  assert.equal(attempts, 2);
});
