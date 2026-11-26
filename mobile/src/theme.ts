import { createContext, useContext } from 'react';
import { StyleSheet } from 'react-native';
import { MD3DarkTheme, MD3LightTheme as base } from 'react-native-paper';
import { font } from './typography';

const materialFonts: typeof base.fonts = { ...base.fonts, default: { ...base.fonts.default, fontFamily: font.regular } };
for (const key of Object.keys(materialFonts) as (keyof typeof materialFonts)[]) {
  if (key === 'default') continue;
  const variant = base.fonts[key];
  materialFonts[key] = { ...variant, fontFamily: variant.fontWeight === '500' ? font.medium : font.regular, fontWeight: 'normal' };
}

const lightMaterial = {
  ...base,
  fonts: materialFonts,
  roundness: 4,
  colors: {
    ...base.colors,
    primary: '#1F5C4A',
    onPrimary: '#FFFFFF',
    primaryContainer: '#DCEDE3',
    onPrimaryContainer: '#0D3829',
    secondary: '#6A6459',
    onSecondary: '#FFFFFF',
    secondaryContainer: '#E4F0E6',
    onSecondaryContainer: '#334D40',
    tertiary: '#7A4B00',
    onTertiary: '#FFFFFF',
    tertiaryContainer: '#FFF0C9',
    onTertiaryContainer: '#694100',
    background: '#FBF7EF',
    onBackground: '#1F1B16',
    surface: '#FBF7EF',
    onSurface: '#1F1B16',
    surfaceVariant: '#E8E2D7',
    onSurfaceVariant: '#6A6459',
    outline: '#756F65',
    outlineVariant: '#E9E2D4',
    surfaceDisabled: 'rgba(29, 27, 32, 0.12)',
    onSurfaceDisabled: 'rgba(29, 27, 32, 0.38)',
    error: '#B3261E',
    onError: '#FFFFFF',
    errorContainer: '#F9DEDC',
    onErrorContainer: '#410E0B',
    inverseSurface: '#2F2B25',
    inverseOnSurface: '#FBF7EF',
    inversePrimary: '#A8D5BE',
    backdrop: 'rgba(50, 47, 53, 0.40)',
    elevation: {
      level0: 'transparent',
      level1: '#F3EFE7',
      level2: '#F4EFE4',
      level3: '#EAE3D7',
      level4: '#E5DED1',
      level5: '#E5DED1',
    },
  },
};

const darkMaterial = {
  ...MD3DarkTheme,
  fonts: materialFonts,
  roundness: 4,
  colors: {
    ...MD3DarkTheme.colors,
    background: '#000000',
    onBackground: '#F2F4F2',
    surface: '#121412',
    onSurface: '#F2F4F2',
    surfaceVariant: '#242824',
    onSurfaceVariant: '#BEC8BF',
    primary: '#92D9B5',
    onPrimary: '#092519',
    primaryContainer: '#17382B',
    onPrimaryContainer: '#B9EFCD',
    secondary: '#B1CBBC',
    onSecondary: '#172D23',
    secondaryContainer: '#1C3329',
    onSecondaryContainer: '#C6E5D4',
    tertiary: '#F1CB83',
    onTertiary: '#3C2A04',
    tertiaryContainer: '#392B14',
    onTertiaryContainer: '#F5DAA2',
    outline: '#87978D',
    outlineVariant: '#384039',
    surfaceDisabled: 'rgba(242, 244, 242, 0.12)',
    onSurfaceDisabled: 'rgba(242, 244, 242, 0.44)',
    error: '#FFB4AA',
    onError: '#601610',
    errorContainer: '#471E1A',
    onErrorContainer: '#FFDAD4',
    inverseSurface: '#E2E7E2',
    inverseOnSurface: '#272C28',
    inversePrimary: '#396B55',
    backdrop: 'rgba(0, 0, 0, 0.72)',
    elevation: {
      level0: 'transparent',
      level1: '#171A17',
      level2: '#1C201C',
      level3: '#222722',
      level4: '#282E28',
      level5: '#2D342D',
    },
  },
};

export const space = { screen: 16, section: 20, panel: 16, row: 10 };
export const radius = { card: 20, control: 12, sheet: 28 };

function makeTheme(material: typeof lightMaterial | typeof darkMaterial) {
  const md = material.colors;
  const dark = material.dark;
  const color = {
    paper: md.background,
    question: md.tertiary,
    card: dark ? md.surface : '#FFFFFF',
    ink: md.onSurface,
    muted: md.onSurfaceVariant,
    primary: md.primary,
    onPrimary: md.onPrimary,
    line: md.outlineVariant,
    outline: md.outline,
    secondaryContainer: md.secondaryContainer,
    onSecondaryContainer: md.onSecondaryContainer,
    primaryContainer: md.primaryContainer,
    onPrimaryContainer: md.onPrimaryContainer,
    tertiaryContainer: md.tertiaryContainer,
    onTertiaryContainer: md.onTertiaryContainer,
    danger: dark ? md.error : md.onErrorContainer,
    errorContainer: md.errorContainer,
    onErrorContainer: md.onErrorContainer,
    surfaceContainer: md.elevation.level2,
    inverseSurface: md.inverseSurface,
    inverseOnSurface: md.inverseOnSurface,
    inversePrimary: md.inversePrimary,
    backdrop: md.backdrop,
    sheet: dark ? md.surface : md.background,
    cover: dark ? '#12251C' : md.primary,
    onCover: dark ? md.onSurface : md.background,
    coverMuted: dark ? md.onSurfaceVariant : md.primaryContainer,
    scanFrame: dark ? '#101D16' : md.onPrimaryContainer,
    scanCorners: dark ? md.primary : md.inversePrimary,
    illustration: dark
      ? { orbit: '#3D6552', sheet: '#254437', rule: '#527867', shadow: '#15221B', tray: '#2D5141',
        trayInterior: '#223C31', page: '#18281F', pageRule: '#789587', gold: '#77572C', goldDeep: '#644622' }
      : { orbit: '#B4D1C0', sheet: '#B3CDBA', rule: '#ADBCAD', shadow: '#E3DDCE', tray: '#B4D1BB',
        trayInterior: '#54836C', page: '#FFFDF6', pageRule: '#98A995', gold: '#DFB46C', goldDeep: '#B98744' },
  };

  const ui = StyleSheet.create({
    safe: { backgroundColor: color.paper, flex: 1 },
    content: { padding: space.screen, paddingBottom: 30, gap: space.section, width: '100%', maxWidth: 680, alignSelf: 'center' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    grow: { flex: 1 },
    stack: { gap: space.row },
    title: { color: color.ink, fontFamily: font.display, fontSize: 34, lineHeight: 38, letterSpacing: -0.5 },
    heading: { color: color.ink, fontFamily: font.display, fontSize: 25, lineHeight: 29, letterSpacing: -0.25 },
    label: { color: color.ink, fontFamily: font.semibold, fontSize: 16, lineHeight: 22 },
    body: { color: color.muted, fontFamily: font.regular, fontSize: 16, lineHeight: 23 },
    small: { color: color.muted, fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
    kicker: { color: color.muted, fontFamily: font.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 0.25 },
    card: { backgroundColor: color.card, borderWidth: 1, borderColor: color.line, borderRadius: radius.card, padding: space.panel, gap: space.row },
    input: { backgroundColor: color.card, minHeight: 48, fontSize: 16 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: color.line },
    money: { color: color.ink, fontFamily: font.uiSans, fontVariant: ['tabular-nums'] },
  });

  return { color, ui, material, dark };
}

export const fairBillThemes = { light: makeTheme(lightMaterial), dark: makeTheme(darkMaterial) };
type FairBillTheme = (typeof fairBillThemes)[keyof typeof fairBillThemes];
const Theme = createContext<FairBillTheme>(fairBillThemes.light);

export const FairBillThemeProvider = Theme.Provider;
export const useFairBillTheme = () => useContext(Theme);

export function themedStyles<T>(factory: (theme: FairBillTheme) => T) {
  const light = factory(fairBillThemes.light);
  const dark = factory(fairBillThemes.dark);
  return function useStyles() {
    return useFairBillTheme().dark ? dark : light;
  };
}
