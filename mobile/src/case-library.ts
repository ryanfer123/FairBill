import type { CasePage } from './api';

export type CaseFilter = 'all' | 'open' | 'complete';

type CaseSummary = CasePage['cases'][number];

const previewLimit = 3;

export function isReviewed(item: CaseSummary) {
  return item.investigated_revision === item.revision;
}

export function caseLibrary(items: CaseSummary[], filter: CaseFilter, full: boolean, archived: boolean, next: string | null | undefined) {
  const matching = items.filter(item => filter === 'all' || isReviewed(item) === (filter === 'complete'));
  const featured = full || archived ? undefined
    : matching.find(item => !item.sample && !isReviewed(item)) ?? matching.find(item => !item.sample);
  const remaining = matching.filter(item => item.id !== featured?.id);
  const canShowAll = !full && !archived && remaining.length > previewLimit;

  return {
    featured,
    rows: full || archived ? remaining : remaining.slice(0, previewLimit),
    canShowAll,
    canLoadMore: !!next && !canShowAll,
    completeInReview: next === null ? items.filter(item => !item.sample && !isReviewed(item)).length : undefined,
  };
}
