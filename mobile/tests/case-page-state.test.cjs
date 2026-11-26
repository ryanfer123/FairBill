const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createCasePageRequests, mergeCasePage, syncArchivePage } = require(process.argv[2] || '../src/case-page-state.ts');

test('retrying a failed refresh starts at the beginning and replaces stale statuses', () => {
  const requests = createCasePageRequests();
  const before = Array.from({ length: 21 }, (_, index) => ({ id: String(index + 1), reviewed: false }));
  const failed = requests.start(null);
  const retry = requests.start(failed.cursor);
  const updated = { id: '1', reviewed: true };

  assert.equal(retry.cursor, null);
  assert.equal(requests.isCurrent(failed), false);
  assert.equal(requests.isCurrent(retry), true);
  assert.deepEqual(mergeCasePage(before, [updated], retry.cursor), [updated]);
});

test('retrying a failed page keeps its cursor and updates overlapping IDs once', () => {
  const requests = createCasePageRequests();
  const before = Array.from({ length: 20 }, (_, index) => ({ id: String(index + 1), reviewed: false }));
  const failed = requests.start('20');
  const retry = requests.start(failed.cursor);
  const page = [{ id: '20', reviewed: true }, { id: '21', reviewed: false }];

  assert.equal(retry.cursor, '20');
  const merged = mergeCasePage(before, page, retry.cursor);
  assert.equal(merged.length, 21);
  assert.deepEqual(merged.slice(-2), page);
  assert.deepEqual([...syncArchivePage(new Set(['1', '20']), page, [null, '21'], retry.cursor)], ['1', '21']);
});

test('blur and refocus reject a delayed page so it cannot replace the refresh', () => {
  const requests = createCasePageRequests();
  const page = requests.start('20');
  requests.invalidate();
  assert.equal(requests.isCurrent(page), false);
  const refresh = requests.start(null);
  assert.equal(requests.isCurrent(page), false);
  assert.equal(requests.isCurrent(refresh), true);
});
