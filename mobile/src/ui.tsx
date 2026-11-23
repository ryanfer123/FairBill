import { Feather } from '@expo/vector-icons';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { AccessibilityInfo, ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { color, radius, ui } from './theme';
export { color, ui } from './theme';

export function Screen({ children }: { children: ReactNode }) {
  return <SafeAreaView style={ui.safe} edges={['top', 'bottom', 'left', 'right']}>{children}</SafeAreaView>;
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={ui.card}>{children}</View>;
}

export function SectionHeader({ children }: { children: ReactNode }) {
  return <Text accessibilityRole="header" style={ui.heading}>{children}</Text>;
}

export function Divider() {
  return <View style={ui.divider} />;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <Card><Text style={ui.body}>{children}</Text></Card>;
}

export function LoadingState({ label }: { label: string }) {
  return <View accessibilityLiveRegion="polite" style={ui.row}>
    <ActivityIndicator color={color.forest} /><Text style={ui.body}>{label}</Text>
  </View>;
}

export type Icon = ComponentProps<typeof Feather>['name'];

export function Mark({ size = 36 }: { size?: number }) {
  return (
    <View style={[styles.mark, { width: size, height: size, borderRadius: size / 3 }]}>
      <Feather name="file-text" size={Math.round(size / 2)} color={color.lime} />
    </View>
  );
}

export function Button({ label, icon, onPress, busy = false, disabled = false, tone = 'primary' }:
  { label: string; icon?: Icon; onPress: () => void; busy?: boolean; disabled?: boolean; tone?: 'primary' | 'light' | 'ghost' | 'destructive' }) {
  const foreground = tone === 'primary' ? color.lime : tone === 'destructive' ? color.red : color.ink;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy, busy }}
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
      {onClose && <Pressable accessibilityLabel="Dismiss message" accessibilityRole="button" onPress={onClose} style={styles.dismiss}>
        <Feather name="x" size={17} color={color.red} />
      </Pressable>}
    </View>
  );
}

export function Sheet({ title, children, onClose, bottom = false }:
  { title: string; children: ReactNode; onClose: () => void; bottom?: boolean }) {
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
    return () => subscription.remove();
  }, []);
  return (
    <Modal animationType={reduceMotion ? 'none' : 'slide'} visible transparent={bottom} onRequestClose={onClose}>
      <View style={bottom ? styles.backdrop : ui.grow}>
      <SafeAreaView style={bottom ? styles.bottomSheet : ui.safe} edges={bottom ? ['bottom', 'left', 'right'] : ['top', 'bottom', 'left', 'right']}>
        <View style={[ui.between, styles.sheetHeader]}>
          <Text style={[ui.heading, ui.grow]}>{title}</Text>
          <IconButton label="Close" icon="x" onPress={onClose} />
        </View>
        {children}
      </SafeAreaView>
      </View>
    </Modal>
  );
}

export const styles = StyleSheet.create({
  mark: { alignItems: 'center', justifyContent: 'center', backgroundColor: color.forest },
  button: { minHeight: 52, borderRadius: radius.control, flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  primary: { backgroundColor: color.forest },
  light: { backgroundColor: color.lime },
  ghost: { backgroundColor: color.card, borderColor: color.line, borderWidth: 1 },
  destructive: { backgroundColor: color.blush, borderWidth: 1, borderColor: color.line },
  pressed: { opacity: 0.76 },
  dim: { opacity: 0.58 },
  buttonText: { fontWeight: '800', fontSize: 15, flexShrink: 1, textAlign: 'center' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.control, borderWidth: 1, borderColor: color.line, backgroundColor: color.card },
  badge: { maxWidth: '100%', alignSelf: 'flex-start', borderRadius: 99, paddingVertical: 5, paddingHorizontal: 9 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  dismiss: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  error: { padding: 12, backgroundColor: color.blush, flexDirection: 'row', gap: 8,
    borderRadius: 12, alignItems: 'center' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#19252266' },
  bottomSheet: { height: '88%', backgroundColor: color.paper, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
  sheetHeader: { paddingHorizontal: 20, paddingBottom: 12, borderBottomColor: color.line,
    borderBottomWidth: 1, paddingTop: 6 },
});
