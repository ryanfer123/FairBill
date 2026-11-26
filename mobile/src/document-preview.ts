import { accountUser } from './cloud-auth';
import type { PickedDocument } from './document-picker';

let latest: { caseId: string; documentId: string; owner: string | undefined; asset: PickedDocument } | undefined;

export function rememberDocumentPreview(caseId: string, documentId: string, asset: PickedDocument) {
  latest = { caseId, documentId, owner: accountUser()?.id, asset };
}

export function documentPreview(caseId: string, documentId: string) {
  if (latest?.caseId === caseId && latest.documentId === documentId && latest.owner === accountUser()?.id) {
    return latest.asset;
  }
}
