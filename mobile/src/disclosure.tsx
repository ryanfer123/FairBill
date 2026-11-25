import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated from 'react-native-reanimated';
import { AppIcon } from './icons';
import { evidenceReveal } from './motion';
import { color, ui } from './theme';

export function Disclosure({ label, accessibilityLabel, open, onToggle, children }:
  { label: string; accessibilityLabel?: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      accessibilityState={{ expanded: open }} onPress={onToggle}
      style={({ pressed }) => [styles.trigger, open && styles.open, pressed && styles.pressed]}>
      <AppIcon name="file-text" size={16} color={color.primary} />
      <Text style={[ui.small, ui.grow, styles.label]}>{label}</Text>
      <AppIcon name={open ? 'chevron-up' : 'chevron-down'} size={16} color={color.primary} />
    </Pressable>
    {open && <Animated.View entering={evidenceReveal} style={styles.content}>{children}</Animated.View>}
  </>;
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', gap: 9, alignItems: 'center', minHeight: 48, borderWidth: 1,
    borderColor: color.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  open: { backgroundColor: color.secondaryContainer, borderColor: color.secondaryContainer },
  pressed: { opacity: 0.75 },
  label: { color: color.primary },
  content: { gap: 7, backgroundColor: color.surfaceContainer, borderRadius: 12, padding: 12 },
});
