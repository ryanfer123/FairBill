import { StyleSheet } from 'react-native';

export const color = {
  paper: '#F4F5F3', card: '#FFFFFF', ink: '#192522', muted: '#485952', forest: '#174F42',
  deeper: '#0C2C23', lime: '#F0F7F3', line: '#D5DEDA', pale: '#E3F0EA',
  mint: '#A2D9AC', amber: '#7E4A1B', sand: '#FCEDD9', red: '#912F3C', blush: '#F9E8EC',
};

export const space = { screen: 16, section: 16, panel: 14, row: 8 };
export const radius = { card: 12, control: 8 };

export const ui = StyleSheet.create({
  safe: { backgroundColor: color.paper, flex: 1 },
  content: { padding: space.screen, paddingBottom: 36, gap: space.section, width: '100%', maxWidth: 680, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  grow: { flex: 1 },
  stack: { gap: 10 },
  title: { color: color.ink, fontSize: 30, fontWeight: '800', letterSpacing: -0.9 },
  heading: { color: color.ink, fontSize: 22, fontWeight: '800', letterSpacing: -0.55 },
  label: { color: color.ink, fontSize: 15, fontWeight: '700' },
  body: { color: color.muted, fontSize: 16, lineHeight: 24 },
  small: { color: color.muted, fontSize: 13, lineHeight: 19 },
  kicker: { color: color.muted, fontSize: 11, letterSpacing: 1.35, fontWeight: '800' },
  card: { backgroundColor: color.card, borderWidth: 1, borderColor: color.line, borderRadius: radius.card, padding: space.panel, gap: space.row },
  input: { backgroundColor: color.card, color: color.ink, borderColor: color.line, borderWidth: 1, borderRadius: radius.control,
    minHeight: 48, paddingHorizontal: 13, paddingVertical: 11, fontSize: 16 },
  money: { color: color.ink, fontVariant: ['tabular-nums'], fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: color.line },
});
