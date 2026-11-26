import { useFairBillTheme, themedStyles } from './theme';
import { useMemo } from 'react';
import { Menu } from 'react-native-paper';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { AppIcon } from './icons';
import { type CasePage } from './api';
import { font } from './typography';
import { isReviewed } from './case-library';

type Props = {
  scrollGesture: ReturnType<typeof Gesture.Native>;
  label?: string;
  onRename: () => void;
  item: CasePage['cases'][number];
  archived: boolean;
  featured?: boolean;
  disabled: boolean;
  onOpen: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onOptions: () => void;
  onDismissOptions: () => void;
  optionsVisible: boolean;
};

export function CaseListRow({ item, label, onRename, archived, featured = false, disabled, onOpen, onArchive, onDelete, onOptions, onDismissOptions, optionsVisible, scrollGesture }: Props) {
  const { color, ui, material } = useFairBillTheme();
  const styles = useStyles();
  const offset = useSharedValue(0);
  const reduced = useReducedMotion();
  const translation = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
  const gesture = useMemo(() => Gesture.Pan()
    .enabled(!disabled && !optionsVisible)
    .maxPointers(1)
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .blocksExternalGesture(scrollGesture)
    .onUpdate(event => {
      'worklet';
      offset.value = Math.max(-108, Math.min(108, event.translationX));
    })
    .onEnd((event, success) => {
      'worklet';
      if (!success || Math.abs(event.translationX) < 64) return;
      if (event.translationX > 0) scheduleOnRN(onArchive);
      else scheduleOnRN(onDelete);
    })
    .onFinalize(() => {
      'worklet';
      offset.value = reduced ? 0 : withTiming(0, { duration: 140 });
    }), [disabled, offset, reduced, scrollGesture, onArchive, onDelete, optionsVisible]);
  const reviewed = isReviewed(item);
  const status = reviewed ? 'Review complete' : 'Needs review';
  const reference = item.id.slice(-6).toUpperCase();
  const title = label || (item.sample ? 'Sample investigation' : 'Hospital bill');
  const next = reviewed ? 'See findings' : 'Continue review';
  return <GestureDetector gesture={gesture}><View collapsable={false} style={styles.container}>
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={styles.actions}>
      <View style={styles.archiveAction}><AppIcon name={archived ? 'restore' : 'archive'} color={color.onPrimary} size={22} />
        <Text style={styles.actionLabel}>{archived ? 'Restore' : 'Archive'}</Text></View>
      <View style={styles.deleteAction}><AppIcon name="trash-2" color={color.onPrimary} size={22} />
        <Text style={styles.actionLabel}>Delete</Text></View>
    </View>
    <Animated.View style={[styles.row, featured && styles.hero, translation]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${title}, case ${reference}, ${status}`}
        accessibilityHint={next} disabled={disabled}
        onPress={onOpen} onLongPress={onOptions} style={({ pressed }) => [styles.open, featured && styles.heroOpen, pressed && styles.pressed]}>
        <View style={[styles.stamp, reviewed && styles.finished]}>
          <AppIcon name={reviewed ? 'receipt' : 'file-text'} size={24} color={reviewed ? color.primary : color.question} />
        </View>
        <View style={ui.grow}>
          <Text style={[styles.title, featured && styles.heroTitle]}>{title}</Text>
          <View style={styles.meta}><Text style={styles.reference}>#{reference}</Text>
            <View style={[styles.dot, reviewed && styles.finishedDot]} /><Text style={styles.status}>{status}</Text></View>
          <View style={styles.nextRow}><Text style={styles.next}>{next}</Text><AppIcon name="arrow-right" size={14} color={color.primary} /></View>
        </View>
      </Pressable>
      <Menu visible={optionsVisible} onDismiss={onDismissOptions} anchorPosition="bottom"
        contentStyle={styles.menu} overlayAccessibilityLabel="Dismiss case options"
        anchor={<Pressable accessibilityRole="button" accessibilityLabel={`Options for case ${reference}`}
          accessibilityState={{ expanded: optionsVisible }} disabled={disabled} onPress={onOptions}
          style={({ pressed }) => [styles.more, pressed && styles.pressed]}>
          <AppIcon name="more" size={23} color={color.muted} />
        </Pressable>}>
        <Menu.Item title={archived ? 'Restore' : 'Archive'} onPress={onArchive}
          leadingIcon={({ size, color: tint }) => <AppIcon name={archived ? 'restore' : 'archive'} size={size} color={tint} />} />
        <Menu.Item title="Edit case label" onPress={onRename}
          leadingIcon={({ size, color: tint }) => <AppIcon name="edit-2" size={size} color={tint} />} />
        <Menu.Item title="Delete case" onPress={onDelete} titleStyle={styles.destructive}
          leadingIcon={({ size }) => <AppIcon name="trash-2" size={size} color={material.colors.error} />} />
      </Menu>
    </Animated.View>
  </View></GestureDetector>;
}

const useStyles = themedStyles(({ color, material }) => StyleSheet.create({
  container: { overflow: 'hidden', borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  row: { alignItems: 'center', flexDirection: 'row', backgroundColor: color.card },
  open: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, minHeight: 84 },
  hero: { backgroundColor: color.secondaryContainer },
  heroOpen: { minHeight: 111 },
  heroTitle: { fontSize: 23 },
  pressed: { backgroundColor: color.surfaceContainer },
  menu: { borderRadius: 14, backgroundColor: color.card },
  destructive: { color: material.colors.error },
  more: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  stamp: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: color.tertiaryContainer },
  finished: { backgroundColor: color.primaryContainer },
  title: { fontFamily: font.uiSans, fontSize: 19, color: color.ink },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 3 },
  reference: { fontFamily: font.mono, color: color.muted, fontSize: 12 },
  nextRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 5 },
  next: { fontFamily: font.semibold, color: color.primary, fontSize: 14 },
  status: { fontFamily: font.medium, color: color.muted, fontSize: 13 },
  dot: { height: 5, width: 5, borderRadius: 3, backgroundColor: color.question, marginStart: 4 },
  finishedDot: { backgroundColor: color.primary },
  actions: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row' },
  archiveAction: { flex: 1, gap: 2, alignItems: 'flex-start', justifyContent: 'center', backgroundColor: color.primary, paddingStart: 12 },
  deleteAction: { flex: 1, gap: 2, alignItems: 'flex-end', justifyContent: 'center', backgroundColor: material.colors.error, paddingEnd: 12 },
  actionLabel: { color: color.onPrimary, fontFamily: font.semibold, fontSize: 12 },
}));
