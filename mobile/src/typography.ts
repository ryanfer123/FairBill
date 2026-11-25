import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';

export const fonts = {
  FairBillRegular: Inter_400Regular,
  FairBillMedium: Inter_500Medium,
  FairBillSemibold: Inter_600SemiBold,
  FairBillBold: Inter_700Bold,
};

export const font = {
  regular: 'FairBillRegular',
  medium: 'FairBillMedium',
  semibold: 'FairBillSemibold',
  bold: 'FairBillBold',
} as const satisfies Record<string, keyof typeof fonts>;
