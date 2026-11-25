import { StyleSheet } from 'react-native';
import { MD3LightTheme as base } from 'react-native-paper';
import { font } from './typography';

const materialFonts: typeof base.fonts = { ...base.fonts, default: { ...base.fonts.default, fontFamily: font.regular } };
for (const key of Object.keys(materialFonts) as (keyof typeof materialFonts)[]) {
  if (key === 'default') continue;
  const variant = base.fonts[key];
  materialFonts[key] = { ...variant, fontFamily: variant.fontWeight === '500' ? font.medium : font.regular, fontWeight: 'normal' };
}

export const material = {
  ...base,
  fonts: materialFonts,
  roundness: 4,
  colors: {
    ...base.colors,
    primary: '#1F6B4F',
    onPrimary: '#FFFFFF',
    primaryContainer: '#D8EEE2',
    onPrimaryContainer: '#0D3829',
    secondary: '#5E5A52',
    onSecondary: '#FFFFFF',
    secondaryContainer: '#E4EEE6',
    onSecondaryContainer: '#334D40',
    tertiary: '#914509',
    onTertiary: '#FFFFFF',
    tertiaryContainer: '#FAE9D4',
    onTertiaryContainer: '#623108',
    background: '#F6F3EC',
    onBackground: '#14110F',
    surface: '#F6F3EC',
    onSurface: '#14110F',
    surfaceVariant: '#E8E2D7',
    onSurfaceVariant: '#5E5A52',
    outline: '#756F65',
    outlineVariant: '#D9D3C7',
    surfaceDisabled: 'rgba(29, 27, 32, 0.12)',
    onSurfaceDisabled: 'rgba(29, 27, 32, 0.38)',
    error: '#B3261E',
    onError: '#FFFFFF',
    errorContainer: '#F9DEDC',
    onErrorContainer: '#410E0B',
    inverseSurface: '#2F2B25',
    inverseOnSurface: '#F6F3EC',
    inversePrimary: '#A8D5BE',
    backdrop: 'rgba(50, 47, 53, 0.40)',
    elevation: {
      level0: 'transparent',
      level1: '#F3EFE7',
      level2: '#EFEAE0',
      level3: '#EAE3D7',
      level4: '#E5DED1',
      level5: '#E5DED1',
    },
  },
};

const md = material.colors;
export const color = {
  paper: md.background,
  question: md.tertiary,
  card: '#FFFFFF',
  ink: md.onSurface,
  muted: md.onSurfaceVariant,
  primary: md.primary,
  onPrimary: md.onPrimary,
  line: md.outlineVariant,
  secondaryContainer: md.secondaryContainer,
  onSecondaryContainer: md.onSecondaryContainer,
  primaryContainer: md.primaryContainer,
  onPrimaryContainer: md.onPrimaryContainer,
  tertiaryContainer: md.tertiaryContainer,
  onTertiaryContainer: md.onTertiaryContainer,
  errorContainer: md.errorContainer,
  onErrorContainer: md.onErrorContainer,
  surfaceContainer: md.elevation.level2,
  inverseSurface: md.inverseSurface,
  inverseOnSurface: md.inverseOnSurface,
  inversePrimary: md.inversePrimary,
  backdrop: md.backdrop,
};

export const space = { screen: 16, section: 20, panel: 16, row: 10 };
export const radius = { card: 20, control: 12, sheet: 28 };

export const ui = StyleSheet.create({
  safe: { backgroundColor: color.paper, flex: 1 },
  content: { padding: space.screen, paddingBottom: 30, gap: space.section, width: '100%', maxWidth: 680, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  grow: { flex: 1 },
  stack: { gap: space.row },
  title: { color: color.ink, fontFamily: font.bold, fontSize: 32, lineHeight: 38, letterSpacing: -1 },
  heading: { color: color.ink, fontFamily: font.semibold, fontSize: 23, lineHeight: 29, letterSpacing: -0.5 },
  label: { color: color.ink, fontFamily: font.semibold, fontSize: 16, lineHeight: 22 },
  body: { color: color.muted, fontFamily: font.regular, fontSize: 16, lineHeight: 24 },
  small: { color: color.muted, fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
  kicker: { color: color.muted, fontFamily: font.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 0.25 },
  card: { backgroundColor: color.card, borderWidth: 1, borderColor: color.line, borderRadius: radius.card, padding: space.panel, gap: space.row },
  input: { backgroundColor: color.card, minHeight: 48, fontSize: 16 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: color.line },
  money: { color: color.ink, fontFamily: font.mono, fontVariant: ['tabular-nums'] },
});
