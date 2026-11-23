import { Feather } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const color = {
  paper: '#F6F7F0', card: '#FFFFFF', ink: '#142F27', muted: '#53685F', forest: '#12372C',
  deeper: '#0C2C23', lime: '#DAF4B3', line: '#DBE3D7', pale: '#E9F1E4',
  mint: '#A2D9AC', amber: '#7E4A1B', sand: '#FCEDD9', red: '#912F3C', blush: '#F9E8EC',
};

export const ui = StyleSheet.create({
  safe: { backgroundColor: color.paper, flex: 1 },
  content: { padding: 20, paddingBottom: 38, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  grow: { flex: 1 },
  stack: { gap: 10 },
  title: { color: color.ink, fontSize: 30, fontWeight: '800', letterSpacing: -0.9 },
  heading: { color: color.ink, fontSize: 22, fontWeight: '800', letterSpacing: -0.55 },
  label: { color: color.ink, fontSize: 15, fontWeight: '700' },
  body: { color: color.muted, fontSize: 15, lineHeight: 22 },
  small: { color: color.muted, fontSize: 13, lineHeight: 19 },
  kicker: { color: color.muted, fontSize: 11, letterSpacing: 1.35, fontWeight: '800' },
  card: { backgroundColor: color.card, borderWidth: 1, borderColor: color.line, borderRadius: 20, padding: 16, gap: 10 },
  input: { backgroundColor: color.card, color: color.ink, borderColor: color.line, borderWidth: 1, borderRadius: 13,
    minHeight: 48, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: color.line },
});

export type Icon = ComponentProps<typeof Feather>['name'];

export function Mark({ size = 36 }: { size?: number }) {
  return (
    <View style={[styles.mark, { width: size, height: size, borderRadius: size / 3 }]}>
      <Feather name="file-text" size={Math.round(size / 2)} color={color.lime} />
    </View>
  );
}

export function Button({ label, icon, onPress, busy = false, disabled = false, tone = 'primary' }:
  { label: string; icon?: Icon; onPress: () => void; busy?: boolean; disabled?: boolean; tone?: 'primary' | 'light' | 'ghost' }) {
  const foreground = tone === 'primary' ? color.lime : color.ink;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [styles.button, styles[tone], (disabled || busy) && styles.dim, pressed && styles.pressed]}>
      <Text style={[styles.buttonText, { color: foreground }]}>{label}</Text>
      {busy ? <ActivityIndicator color={foreground} /> : icon && <Feather name={icon} size={17} color={foreground} />}
    </Pressable>
  );
}

export function IconButton({ label, icon, onPress }: { label: string; icon: Icon; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
      <Feather name={icon} color={color.ink} size={21} />
    </Pressable>
  );
}

export function Badge({ children, tone = 'green' }: { children: ReactNode; tone?: 'green' | 'amber' | 'neutral' }) {
  const tint = tone === 'amber' ? color.sand : tone === 'green' ? color.pale : color.paper;
  return <View style={[styles.badge, { backgroundColor: tint }]}>
    <Text style={[styles.badgeText, { color: tone === 'amber' ? color.amber : color.ink }]}>{children}</Text>
  </View>;
}

export function Message({ text, onClose }: { text: string; onClose?: () => void }) {
  return (
    <View accessibilityRole="alert" style={styles.error}>
      <Feather name="alert-circle" size={18} color={color.red} />
      <Text style={[ui.small, ui.grow, { color: color.red }]}>{text}</Text>
      {onClose && <Pressable accessibilityLabel="Dismiss message" accessibilityRole="button" onPress={onClose} hitSlop={8}>
        <Feather name="x" size={17} color={color.red} />
      </Pressable>}
    </View>
  );
}

export function Sheet({ title, children, onClose }:
  { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <Modal animationType="slide" visible onRequestClose={onClose}>
      <SafeAreaView style={ui.safe} edges={['top', 'bottom']}>
        <View style={[ui.between, styles.sheetHeader]}>
          <Text style={[ui.heading, ui.grow]}>{title}</Text>
          <IconButton label="Close" icon="x" onPress={onClose} />
        </View>
        {children}
      </SafeAreaView>
    </Modal>
  );
}

export const styles = StyleSheet.create({
  mark: { alignItems: 'center', justifyContent: 'center', backgroundColor: color.forest },
  button: { minHeight: 52, borderRadius: 15, flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  primary: { backgroundColor: color.forest },
  light: { backgroundColor: color.lime },
  ghost: { backgroundColor: color.card, borderColor: color.line, borderWidth: 1 },
  pressed: { opacity: 0.76 },
  dim: { opacity: 0.58 },
  buttonText: { fontWeight: '800', fontSize: 15, flexShrink: 1, textAlign: 'center' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: 14, borderWidth: 1, borderColor: color.line, backgroundColor: color.card },
  badge: { alignSelf: 'flex-start', borderRadius: 99, paddingVertical: 5, paddingHorizontal: 9 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  error: { padding: 12, backgroundColor: color.blush, flexDirection: 'row', gap: 8,
    borderRadius: 12, alignItems: 'center' },
  sheetHeader: { paddingHorizontal: 20, paddingBottom: 12, borderBottomColor: color.line,
    borderBottomWidth: 1, paddingTop: 6 },
});
