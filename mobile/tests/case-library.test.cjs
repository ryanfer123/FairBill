const assert = require('node:assert/strict');
const { test } = require('node:test');
const { caseLibrary } = require('../src/case-library.ts');
const { mergeCasePage } = require('../src/case-page-state.ts');

function item(id, { reviewed = false, sample = false } = {}) {
  return { id, sample, revision: 5, investigated_revision: reviewed ? 5 : 3 };
}

test('empty and single-case libraries avoid redundant navigation', () => {
  const empty = caseLibrary([], 'all', false, false, null);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.featured, undefined);
  assert.equal(empty.canShowAll, false);
  const only = item('one');
  const single = caseLibrary([only], 'all', false, false, null);
  assert.equal(single.featured, only);
  assert.deepEqual(single.rows, []);
  assert.equal(single.canShowAll, false);
  assert.equal(single.completeInReview, 1);
});

test('the hero prioritizes a real in-progress case and honors filters', () => {
  const reviewed = item('reviewed', { reviewed: true });
  const sample = item('sample', { sample: true });
  const pending = item('pending');
  const records = [reviewed, sample, pending];
  assert.equal(caseLibrary(records, 'all', false, false, null).featured, pending);
  assert.equal(caseLibrary(records, 'complete', false, false, null).featured, reviewed);
  assert.equal(caseLibrary([reviewed, sample], 'all', false, false, null).featured, reviewed);
  assert.equal(caseLibrary(records, 'all', false, true, null).featured, undefined);
  assert.equal(caseLibrary(records, 'all', false, false, null).completeInReview, 1);
});

test('View all reveals extra loaded cases and preserves the next-page action', () => {
  const firstPage = Array.from({ length: 20 }, (_, index) => item(`case-${index}`));
  const preview = caseLibrary(firstPage, 'all', false, false, 'page-two');
  assert.equal(preview.featured, firstPage[0]);
  assert.deepEqual(preview.rows, firstPage.slice(1, 4));
  assert.equal(preview.canShowAll, true);
  assert.equal(preview.canLoadMore, false);
  assert.equal(preview.completeInReview, undefined);

  const full = caseLibrary(firstPage, 'all', true, false, 'page-two');
  assert.equal(full.featured, undefined);
  assert.equal(full.rows.length, 20);
  assert.equal(full.canLoadMore, true);
  const secondPage = [item('case-20', { reviewed: true }), item('case-21')];
  const next = caseLibrary(mergeCasePage(firstPage, secondPage, 'page-two'), 'all', true, false, null);
  assert.equal(new Set(next.rows.map(record => record.id)).size, 22);
  assert.equal(next.completeInReview, 21);
  assert.equal(next.canLoadMore, false);
});

test('filters can request another page when the preview has no hidden rows', () => {
  const entries = [item('pending')];
  const filtered = caseLibrary(entries, 'complete', false, false, 'page-two');
  assert.deepEqual(filtered.rows, []);
  assert.equal(filtered.canShowAll, false);
  assert.equal(filtered.canLoadMore, true);
});
