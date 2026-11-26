const assert = require('node:assert/strict');
const { test } = require('node:test');
const { shouldShowFirstBillGuide, finishFirstBillGuide } = require('../src/first-bill-guide.ts');

function freshStorage() {
  const values = new Map();
  return {
    getItemAsync: async key => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
  };
}

test('a fresh empty account sees the guide until it is dismissed locally', async () => {
  const device = freshStorage();
  assert.equal(await shouldShowFirstBillGuide(device, async () => false), true);
  await finishFirstBillGuide(device);
  assert.equal(await shouldShowFirstBillGuide(device, async () => assert.fail('dismissal needs no server call')), false);
  assert.equal(await shouldShowFirstBillGuide(freshStorage(), async () => false), true);
});

test('a returning account with cases skips the guide even without a local recent case', async () => {
  const device = freshStorage();
  assert.equal(await shouldShowFirstBillGuide(device, async () => true), false);
  assert.equal(await shouldShowFirstBillGuide(device, async () => assert.fail('returning device needs no second lookup')), false);
});

test('an unavailable case list is not treated as an empty account', async () => {
  const device = freshStorage();
  await assert.rejects(shouldShowFirstBillGuide(device, async () => { throw new Error('Offline'); }), /Offline/);
  assert.equal(await shouldShowFirstBillGuide(device, async () => false), true);
});
