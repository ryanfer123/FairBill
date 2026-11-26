import type { Kind } from './api';

// Versioned imports use the idempotency key as their document ID. Never pair a
// picked original with a different document from a refreshed case snapshot.
export function importedDocument<T extends { id: string; kind: Kind; confirmed: boolean }>(
  documents: readonly T[], kind: Kind, importId: string, versioned: boolean,
) {
  const document = versioned ? documents.find(item => item.id === importId) : documents.at(-1);
  return document?.kind === kind && !document.confirmed ? document : undefined;
}
