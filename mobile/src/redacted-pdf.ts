import * as Crypto from 'expo-crypto';
import { requireOptionalNativeModule } from 'expo';
import { Directory, File, Paths } from 'expo-file-system';
import { downloadAsync } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { apiUrl, headers } from './api';

export type PacketAction = 'open' | 'save' | 'share';

const pdfModule = Platform.OS === 'android' ? requireOptionalNativeModule<{
  openPdf(fileUri: string): Promise<void>;
  savePdf(fileUri: string): Promise<boolean>;
}>('FairBillPdf') : null;

export const supportsLocalPacketActions = pdfModule !== null;
const maxCacheAge = 60 * 60 * 1000;
const pdfSignature = [0x25, 0x50, 0x44, 0x46, 0x2d];

function removeTemporary(directory: Directory) {
  try { if (directory.exists) directory.delete(); } catch { /* Android may clean this cache itself. */ }
}

export async function performPacketAction(caseId: string, revision: number, action: PacketAction) {
  if (action === 'share' ? !(await Sharing.isAvailableAsync()) : !pdfModule) {
    throw new Error('This PDF action is unavailable on this device.');
  }
  const cache = new Directory(Paths.cache, 'fairbill-packets');
  cache.create({ intermediates: true, idempotent: true });
  // Reclaim files from interrupted handoffs. Each action owns its own temporary copy.
  for (const entry of cache.list()) {
    if (entry instanceof Directory && (entry.info().modificationTime ?? Date.now()) < Date.now() - maxCacheAge) {
      removeTemporary(entry);
    }
  }
  const temporary = new Directory(cache, Crypto.randomUUID());
  temporary.create();
  let wasShared = false;
  try {
    const file = new File(temporary, 'FairBill-evidence.pdf');
    const url = await apiUrl(`/cases/${caseId}/packet?revision=${revision}`);
    const result = await downloadAsync(url, file.uri, { headers: await headers() });
    const type = Object.entries(result.headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
    if (result.status !== 200 || type?.split(';')[0]?.trim().toLowerCase() !== 'application/pdf' || file.size < 5) {
      throw new Error('The redacted PDF could not be downloaded for this revision.');
    }
    const handle = file.open();
    try {
      const signature = handle.readBytes(pdfSignature.length);
      if (!pdfSignature.every((byte, index) => signature[index] === byte)) {
        throw new Error('The server did not return a readable PDF.');
      }
    } finally {
      handle.close();
    }
    if (action === 'save') return (await pdfModule?.savePdf(file.uri)) === true;
    if (action === 'open') await pdfModule?.openPdf(file.uri);
    if (action === 'share') {
      await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: 'Share redacted FairBill packet' });
      // Some receivers read the file after the share chooser returns.
      wasShared = true;
    }
    return false;
  } finally {
    if (!wasShared) removeTemporary(temporary);
  }
}
