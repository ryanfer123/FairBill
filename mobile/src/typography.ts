export const fonts = {
  FairBillUISans: require('../assets/fonts/FairBillUISans-Semibold.ttf'),
  FairBillRegular: require('../assets/fonts/PTSans-Regular.ttf'),
  FairBillBold: require('../assets/fonts/PTSans-Bold.ttf'),
  FairBillDisplay: require('../assets/fonts/CrimsonPro-Bold.ttf'),
  FairBillEditorial: require('../assets/fonts/CrimsonPro-Regular.ttf'),
  FairBillMono: require('../assets/fonts/SourceCodePro-Medium.ttf'),
};

export const font = {
  uiSans: 'FairBillUISans',
  regular: 'FairBillRegular',
  medium: 'FairBillBold',
  semibold: 'FairBillBold',
  bold: 'FairBillBold',
  display: 'FairBillDisplay',
  editorial: 'FairBillEditorial',
  mono: 'FairBillMono',
} as const satisfies Record<string, keyof typeof fonts>;
