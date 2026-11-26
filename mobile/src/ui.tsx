import { radius, themedStyles, useFairBillTheme } from './theme';
import { StatusBar } from 'expo-status-bar';
import { AppIcon, type IconName } from './icons';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, Pressable, ScrollView, StyleSheet, Text, View, type TextProps } from 'react-native';
import { Button as MaterialButton, Divider as MaterialDivider, IconButton as MaterialIconButton, ProgressBar, Surface, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Illustration } from './illustrations';
import { useReducedMotion } from 'react-native-reanimated';

import { font } from './typography';

export function Screen({ children }: { children: ReactNode }) {
  const { ui } = useFairBillTheme();
  return <SafeAreaView style={ui.safe} edges={['top', 'bottom', 'left', 'right']}>{children}</SafeAreaView>;
}

export function Card({ children, tone = 'outline' }: { children: ReactNode; tone?: 'outline' | 'tonal' }) {
  const { ui } = useFairBillTheme();
  const styles = useStyles();
  return <Surface elevation={0} style={[ui.card, tone === 'tonal' && styles.tonal]}>{children}</Surface>;
}

export function Input({ style, label, accessibilityLabel, ...props }: ComponentProps<typeof TextInput>) {
  const { ui, dark } = useFairBillTheme();
  const currencyLabel = typeof label === 'string' && label.includes('₹') ? label : undefined;
  return <TextInput keyboardAppearance={dark ? 'dark' : 'light'} {...props}
    label={currencyLabel ? <CurrencyText>{currencyLabel}</CurrencyText> : label}
    accessibilityLabel={accessibilityLabel ?? currencyLabel} mode="outlined" style={[ui.input, style]} />;
}

export function CurrencyText({ children, ...props }: TextProps & { children: string }) {
  return <Text {...props}>{children.split(/(₹)/).map((part, index) =>
    part === '₹' ? <Text key={index} style={{ fontFamily: font.uiSans }}>{part}</Text> : part
  )}</Text>;
}

export function ActionBar({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <Surface elevation={1} style={styles.actionBar}>
    <View style={styles.actionContent}>{children}</View>
  </Surface>;
}


export function SectionHeader({ children }: { children: ReactNode }) {
  const { ui } = useFairBillTheme();
  return <Text accessibilityRole="header" style={ui.heading}>{children}</Text>;
}

export function Divider() {
  return <MaterialDivider />;
}

export function EmptyState({ children }: { children: ReactNode }) {
  const { ui } = useFairBillTheme();
  return <Card><Text style={ui.body}>{children}</Text></Card>;
}

export function LoadingState({ label }: { label: string }) {
  const { ui, color } = useFairBillTheme();
  const styles = useStyles();
  const reduceMotion = useReducedMotion();
  return <View accessibilityLiveRegion="polite" accessibilityState={{ busy: true }} style={ui.stack}>
    <Text style={ui.label}>{label}</Text>
    {reduceMotion ? <View style={styles.progressTrack} />
      : <ProgressBar indeterminate color={color.primary} importantForAccessibility="no" style={styles.progressTrack} />}
  </View>;
}

export type Icon = IconName;

export function Mark({ size = 36 }: { size?: number }) {
  return <Illustration name="corrected" size={size} />;
}

export function Button({ label, icon, onPress, busy = false, disabled = false, tone = 'primary' }:
  { label: string; icon?: Icon; onPress: () => void; busy?: boolean; disabled?: boolean; tone?: 'primary' | 'light' | 'ghost' | 'destructive' }) {
  const { color } = useFairBillTheme();
  const styles = useStyles();
  const mode = tone === 'ghost' ? 'outlined' : tone === 'primary' ? 'contained' : 'contained-tonal';
  return <MaterialButton mode={mode} accessibilityLabel={label}
    accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy}
    loading={busy} onPress={onPress}
    icon={icon ? ({ size, color: foreground }) => <AppIcon name={icon} size={size} color={foreground} /> : undefined}
    buttonColor={tone === 'destructive' ? color.errorContainer : undefined}
    textColor={tone === 'destructive' ? color.onErrorContainer : undefined}
    contentStyle={styles.buttonContent} labelStyle={styles.buttonText}>
    {label}
  </MaterialButton>;
}

export function IconButton({ label, icon, onPress }: { label: string; icon: Icon; onPress: () => void }) {
  const styles = useStyles();
  return <MaterialIconButton mode="contained-tonal" accessibilityLabel={label} size={20} onPress={onPress}
    style={styles.iconButton}
    icon={({ size, color: foreground }) => <AppIcon name={icon} size={size} color={foreground} />} />;
}

export function Badge({ children, tone = 'green' }: { children: ReactNode; tone?: 'green' | 'amber' | 'neutral' }) {
  const { color } = useFairBillTheme();
  const styles = useStyles();
  const tint = tone === 'amber' ? color.tertiaryContainer : tone === 'green' ? color.secondaryContainer : color.surfaceContainer;
  return <View style={[styles.badge, { backgroundColor: tint }]}>
    <Text style={[styles.badgeText, { color: tone === 'amber' ? color.onTertiaryContainer : color.ink }]}>{children}</Text>
  </View>;
}

export function Message({ text, onClose }: { text: string; onClose?: () => void }) {
  const { color, ui } = useFairBillTheme();
  const styles = useStyles();
  return (
    <View accessibilityRole="alert" style={styles.error}>
      <AppIcon name="alert-circle" size={18} color={color.onErrorContainer} />
      <CurrencyText style={[ui.small, ui.grow, { color: color.onErrorContainer }]}>{text}</CurrencyText>
      {onClose && <Pressable accessibilityLabel="Dismiss message" accessibilityRole="button" onPress={onClose} style={styles.dismiss}>
        <AppIcon name="x" size={17} color={color.onErrorContainer} />
      </Pressable>}
    </View>
  );
}

type SheetConfirmation = {
  title: string; detail: string; keep: string; discard: string; onKeep: () => void; onDiscard: () => void;
};

function ConfirmationOverlay({ confirmation }: { confirmation: SheetConfirmation }) {
  const { color, ui } = useFairBillTheme();
  const styles = useStyles();
  const heading = useRef<Text>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const target = findNodeHandle(heading.current);
      if (target != null) AccessibilityInfo.setAccessibilityFocus(target);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return <View style={styles.confirmationBackdrop} accessibilityViewIsModal onAccessibilityEscape={confirmation.onKeep}>
    <ScrollView style={styles.confirmationScroll} contentContainerStyle={styles.confirmationInset}>
      <View style={styles.confirmationCard}>
        <View style={styles.confirmationIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <AppIcon name="alert-circle" size={22} color={color.question} />
        </View>
        <Text ref={heading} accessible accessibilityRole="header" style={ui.heading}>{confirmation.title}</Text>
        <Text style={ui.body}>{confirmation.detail}</Text>
        <Button label={confirmation.keep} onPress={confirmation.onKeep} />
        <Button label={confirmation.discard} tone="destructive" onPress={confirmation.onDiscard} />
      </View>
    </ScrollView>
  </View>;
}

export function Sheet({ title, children, onClose, bottom = false, compact = false, confirmation }:
  { title: string; children: ReactNode; onClose: () => void; bottom?: boolean; compact?: boolean; confirmation?: SheetConfirmation }) {
  const { ui, dark } = useFairBillTheme();
  const styles = useStyles();
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
    return () => subscription.remove();
  }, []);
  return (
    <Modal animationType={reduceMotion ? 'none' : 'slide'} visible transparent={bottom} onRequestClose={onClose}
      statusBarTranslucent={dark} navigationBarTranslucent={dark}>
      {dark && <StatusBar style="light" />}
      <View style={bottom ? styles.backdrop : ui.grow}>
      <SafeAreaView style={bottom ? [styles.bottomSheet, compact && styles.compactSheet] : ui.safe} edges={bottom ? ['bottom', 'left', 'right'] : ['top', 'bottom', 'left', 'right']}>
        <View style={!bottom || !compact ? ui.grow : undefined}
          pointerEvents={confirmation ? 'none' : 'auto'}
          accessibilityElementsHidden={!!confirmation}
          importantForAccessibility={confirmation ? 'no-hide-descendants' : 'auto'}>
          {bottom && <View style={styles.handle} importantForAccessibility="no" />}
          <View style={[ui.between, styles.sheetHeader]}>
            <Text style={[ui.heading, ui.grow]}>{title}</Text>
            <IconButton label="Close" icon="x" onPress={onClose} />
          </View>
          {children}
        </View>
        {confirmation && <ConfirmationOverlay confirmation={confirmation} />}
      </SafeAreaView>
      </View>
    </Modal>
  );
}

const useStyles = themedStyles(({ color }) => StyleSheet.create({
  tonal: { backgroundColor: color.surfaceContainer, borderColor: 'transparent' },
  buttonContent: { minHeight: 48 },
  buttonText: { fontFamily: font.semibold, fontSize: 14, textAlign: 'center' },
  iconButton: { width: 48, height: 48, margin: 0 },
  actionBar: { paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  actionContent: { width: '100%', maxWidth: 648, alignSelf: 'center', gap: 8 },
  handle: { alignSelf: 'center', marginTop: 10, width: 30, height: 4, borderRadius: 2, backgroundColor: color.line },
  badge: { maxWidth: '100%', alignSelf: 'flex-start', borderRadius: 99, paddingVertical: 5, paddingHorizontal: 9 },
  badgeText: { fontFamily: font.semibold, fontSize: 12 },
  progressTrack: { height: 4, borderRadius: 4, backgroundColor: color.secondaryContainer, overflow: 'hidden' },
  dismiss: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  error: { padding: 12, backgroundColor: color.errorContainer, flexDirection: 'row', gap: 8,
    borderRadius: 12, alignItems: 'center' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: color.backdrop },
  bottomSheet: { height: '88%', backgroundColor: color.sheet, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet },
  compactSheet: { height: 'auto', maxHeight: '90%' },
  confirmationBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: color.backdrop },
  confirmationScroll: { flex: 1 },
  confirmationInset: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  confirmationCard: { alignSelf: 'center', width: '100%', maxWidth: 420, padding: 20, gap: 12,
    borderRadius: 24, backgroundColor: color.sheet, borderColor: color.line, borderWidth: 1 },
  confirmationIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center',
    justifyContent: 'center', backgroundColor: color.tertiaryContainer },
  sheetHeader: { paddingHorizontal: 20, paddingBottom: 12, borderBottomColor: color.line,
    borderBottomWidth: 1, paddingTop: 6 },
}));
