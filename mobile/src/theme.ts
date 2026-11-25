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
    primary: '#6750A4',
    onPrimary: '#FFFFFF',
    primaryContainer: '#EADDFF',
    onPrimaryContainer: '#21005D',
    secondary: '#625B71',
    onSecondary: '#FFFFFF',
    secondaryContainer: '#E8DEF8',
    onSecondaryContainer: '#4A4459',
    tertiary: '#7D5260',
    onTertiary: '#FFFFFF',
    tertiaryContainer: '#FFD8E4',
    onTertiaryContainer: '#31111D',
    background: '#FEF7FF',
    onBackground: '#1D1B20',
    surface: '#FEF7FF',
    onSurface: '#1D1B20',
    surfaceVariant: '#E7E0EC',
    onSurfaceVariant: '#49454F',
    outline: '#79747E',
    outlineVariant: '#CAC4D0',
    surfaceDisabled: 'rgba(29, 27, 32, 0.12)',
    onSurfaceDisabled: 'rgba(29, 27, 32, 0.38)',
    error: '#B3261E',
    onError: '#FFFFFF',
    errorContainer: '#F9DEDC',
    onErrorContainer: '#410E0B',
    inverseSurface: '#322F35',
    inverseOnSurface: '#F5EFF7',
    inversePrimary: '#D0BCFF',
    backdrop: 'rgba(50, 47, 53, 0.40)',
    elevation: {
      level0: 'transparent',
      level1: '#F7F2FA',
      level2: '#F3EDF7',
      level3: '#ECE6F0',
      level4: '#E6E0E9',
      level5: '#E6E0E9',
    },
  },
};

const md = material.colors;
export const color = {
  paper: md.background,
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
  money: { color: color.ink, fontFamily: font.bold, fontVariant: ['tabular-nums'] },
});
