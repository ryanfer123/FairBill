const assert = require('node:assert/strict');
const { test } = require('node:test');
const { importedDocument } = require('../src/import-result.ts');

const pending = (id, kind = 'invoice') => ({ id, kind, confirmed: false });

test('a versioned retry opens the exact document, not the most recent attachment', () => {
  const original = pending('original');
  const newer = pending('newer', 'service_record');
  assert.equal(importedDocument([original, newer], 'invoice', 'original', true), original);
  assert.equal(importedDocument([newer], 'service_record', 'missing', true), undefined);
});

test('an already confirmed or different kind cannot be mistaken for a pending import', () => {
  const invoice = pending('original');
  assert.equal(importedDocument([{ ...invoice, confirmed: true }], 'invoice', 'original', true), undefined);
  assert.equal(importedDocument([invoice], 'policy', 'original', true), undefined);
});

test('legacy import accepts only a matching unconfirmed final attachment', () => {
  const invoice = pending('legacy-id');
  assert.equal(importedDocument([invoice], 'invoice', 'client-id', false), invoice);
  assert.equal(importedDocument([invoice, pending('other', 'policy')], 'invoice', 'client-id', false), undefined);
});
