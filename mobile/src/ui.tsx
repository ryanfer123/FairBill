import { Feather } from '@expo/vector-icons';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { AccessibilityInfo, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator, Button as MaterialButton, Divider as MaterialDivider, IconButton as MaterialIconButton, Surface, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { color, radius, ui } from './theme';
export { color, ui } from './theme';

export function Screen({ children }: { children: ReactNode }) {
  return <SafeAreaView style={ui.safe} edges={['top', 'bottom', 'left', 'right']}>{children}</SafeAreaView>;
}

export function Card({ children, tone = 'outline' }: { children: ReactNode; tone?: 'outline' | 'tonal' }) {
  return <Surface elevation={0} style={[ui.card, tone === 'tonal' && styles.tonal]}>{children}</Surface>;
}

export function Input({ style, ...props }: ComponentProps<typeof TextInput>) {
  return <TextInput {...props} mode="outlined" style={[ui.input, style]} />;
}

export function ActionBar({ children }: { children: ReactNode }) {
  return <Surface elevation={1} style={styles.actionBar}>
    <View style={styles.actionContent}>{children}</View>
  </Surface>;
}


export function SectionHeader({ children }: { children: ReactNode }) {
  return <Text accessibilityRole="header" style={ui.heading}>{children}</Text>;
}

export function Divider() {
  return <MaterialDivider />;
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
  const mode = tone === 'ghost' ? 'outlined' : tone === 'primary' ? 'contained' : 'contained-tonal';
  return <MaterialButton mode={mode} accessibilityLabel={label}
    accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy}
    loading={busy} onPress={onPress}
    icon={icon ? ({ size, color: foreground }) => <Feather name={icon} size={size} color={foreground} /> : undefined}
    buttonColor={tone === 'destructive' ? color.blush : undefined}
    textColor={tone === 'destructive' ? color.red : undefined}
    contentStyle={styles.buttonContent} labelStyle={styles.buttonText}>
    {label}
  </MaterialButton>;
}

export function IconButton({ label, icon, onPress }: { label: string; icon: Icon; onPress: () => void }) {
  return <MaterialIconButton mode="contained-tonal" accessibilityLabel={label} size={20} onPress={onPress}
    style={styles.iconButton}
    icon={({ size, color: foreground }) => <Feather name={icon} size={size} color={foreground} />} />;
}

export function Badge({ children, tone = 'green' }: { children: ReactNode; tone?: 'green' | 'amber' | 'neutral' }) {
  const tint = tone === 'amber' ? color.sand : tone === 'green' ? color.pale : color.panel;
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
        {bottom && <View style={styles.handle} importantForAccessibility="no" />}
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
  tonal: { backgroundColor: color.panel, borderColor: 'transparent' },
  buttonContent: { minHeight: 48 },
  buttonText: { fontWeight: '600', fontSize: 14, textAlign: 'center' },
  iconButton: { width: 44, height: 44, margin: 0 },
  actionBar: { paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  actionContent: { width: '100%', maxWidth: 648, alignSelf: 'center', gap: 8 },
  handle: { alignSelf: 'center', marginTop: 10, width: 30, height: 4, borderRadius: 2, backgroundColor: color.line },
  badge: { maxWidth: '100%', alignSelf: 'flex-start', borderRadius: 99, paddingVertical: 5, paddingHorizontal: 9 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  dismiss: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  error: { padding: 12, backgroundColor: color.blush, flexDirection: 'row', gap: 8,
    borderRadius: 12, alignItems: 'center' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#19252266' },
  bottomSheet: { height: '88%', backgroundColor: color.paper, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet },
  sheetHeader: { paddingHorizontal: 20, paddingBottom: 12, borderBottomColor: color.line,
    borderBottomWidth: 1, paddingTop: 6 },
});
