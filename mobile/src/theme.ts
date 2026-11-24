import { StyleSheet } from 'react-native';
import { MD3LightTheme as base } from 'react-native-paper';

export const material = {
  ...base,
  roundness: 4,
  colors: {
    ...base.colors,
    primary: '#00433D',
    onPrimary: '#FFFFFF',
    primaryContainer: '#CDE8E2',
    onPrimaryContainer: '#00433D',
    secondary: '#4C645C',
    onSecondary: '#FFFFFF',
    secondaryContainer: '#DDEBE3',
    onSecondaryContainer: '#17352C',
    tertiary: '#73572E',
    tertiaryContainer: '#F7E6C9',
    onTertiaryContainer: '#432B0C',
    background: '#F8FAF8',
    onBackground: '#191C1B',
    surface: '#FFFFFF',
    onSurface: '#191C1B',
    surfaceVariant: '#E2EAE3',
    onSurfaceVariant: '#3F4947',
    outline: '#677D73',
    outlineVariant: '#BEC9C6',
    error: '#922D3C',
    errorContainer: '#FBE5E8',
    onErrorContainer: '#771A29',
    elevation: {
      level0: 'transparent',
      level1: '#F2F4F2',
      level2: '#ECEEEC',
      level3: '#E4EEE6',
      level4: '#DFEAE2',
      level5: '#DAE7DE',
    },
  },
};

const md = material.colors;
export const color = {
  paper: md.background,
  card: md.surface,
  ink: md.onSurface,
  muted: md.onSurfaceVariant,
  forest: md.primary,
  deeper: md.onPrimaryContainer,
  lime: md.onPrimary,
  line: md.outlineVariant,
  pale: md.secondaryContainer,
  mint: md.primaryContainer,
  amber: md.onTertiaryContainer,
  sand: md.tertiaryContainer,
  red: md.onErrorContainer,
  blush: md.errorContainer,
  panel: md.elevation.level2,
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
  title: { color: color.ink, fontSize: 32, fontWeight: '600', letterSpacing: -0.8 },
  heading: { color: color.ink, fontSize: 23, fontWeight: '600', letterSpacing: -0.4 },
  label: { color: color.ink, fontSize: 16, fontWeight: '600' },
  body: { color: color.muted, fontSize: 16, lineHeight: 24 },
  small: { color: color.muted, fontSize: 14, lineHeight: 20 },
  kicker: { color: color.muted, fontSize: 12, lineHeight: 16, letterSpacing: 0.25, fontWeight: '600' },
  card: { backgroundColor: color.card, borderWidth: 1, borderColor: color.line, borderRadius: radius.card, padding: space.panel, gap: space.row },
  input: { backgroundColor: color.card, minHeight: 48, fontSize: 16 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: color.line },
  money: { color: color.ink, fontVariant: ['tabular-nums'], fontWeight: '700' },
});
