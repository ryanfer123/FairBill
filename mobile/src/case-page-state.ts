export type CaseCursor = string | null;

type PageRequest = { generation: number; cursor: CaseCursor };

export function createCasePageRequests() {
  let generation = 0;
  return {
    start(cursor: CaseCursor): PageRequest { return { cursor, generation: ++generation }; },
    isCurrent(request: PageRequest) { return generation === request.generation; },
    invalidate() { generation += 1; },
  };
}

export function mergeCasePage<T extends { id: string }>(current: T[], incoming: T[], cursor: CaseCursor) {
  const byId = new Map<string, T>();
  if (cursor !== null) for (const item of current) byId.set(item.id, item);
  for (const item of incoming) byId.set(item.id, item);
  return Array.from(byId.values());
}

export function syncArchivePage<T extends { id: string }>(current: Set<string>, incoming: T[],
  archived: (string | null)[], cursor: CaseCursor) {
  const next = cursor === null ? new Set<string>() : new Set(current);
  for (const item of incoming) next.delete(item.id);
  for (const id of archived) if (id !== null) next.add(id);
  return next;
}
