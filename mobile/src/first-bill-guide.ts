const guideKey = 'fairbill_first_bill_guide_done_v1';

type GuideStorage = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
};

export function finishFirstBillGuide(storage: GuideStorage) {
  return storage.setItemAsync(guideKey, '1');
}

export async function shouldShowFirstBillGuide(storage: GuideStorage, hasCases: () => Promise<boolean>) {
  if (await storage.getItemAsync(guideKey)) return false;
  if (!await hasCases()) return true;
  await finishFirstBillGuide(storage);
  return false;
}
