const assert = require('node:assert/strict');
const { test } = require('node:test');
const { classifyRequest } = require(process.env.FAIRBILL_COMPILED_INTENT);

test('routes common patient goals to reversible workflows', () => {
  for (const [phrase, intent] of [
    ['I think I was charged twice for a blood test', 'investigate'],
    ['Why did insurance pay less?', 'investigate'],
    ['What do I owe now?', 'investigate'],
    ['Can you ask the hospital for an itemised bill?', 'letter'],
    ['Draft a billing letter', 'letter'],
    ['Help me question this charge', 'investigate'],
  ]) assert.equal(classifyRequest(phrase).intent, intent, phrase);
});

test('declines an external send or fabricated record request', () => {
  for (const phrase of ['Send this bill to my insurer', 'Forge a billing record', 'Email my grandmother']) {
    assert.equal(classifyRequest(phrase).intent, 'unknown', phrase);
  }
});
