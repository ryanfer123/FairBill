import { useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { AppIcon } from './icons';
import { type CasePage } from './api';
import { font } from './typography';
import { color, material, ui } from './theme';

type Props = {
  item: CasePage['cases'][number];
  archived: boolean;
  disabled: boolean;
  onOpen: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onOptions: () => void;
};

export function CaseListRow({ item, archived, disabled, onOpen, onArchive, onDelete, onOptions }: Props) {
  const offset = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  const gesture = useMemo(() => {
    const reset = () => {
      if (reduced) offset.setValue(0);
      else Animated.timing(offset, { toValue: 0, duration: 140, useNativeDriver: true }).start();
    };
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, { dx, dy, numberActiveTouches }) =>
        !disabled && numberActiveTouches === 1 && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.7,
      onPanResponderGrant: () => offset.stopAnimation(),
      onPanResponderMove: (_, { dx }) => offset.setValue(Math.max(-108, Math.min(108, dx))),
      onPanResponderRelease: (_, { dx, dy }) => {
        reset();
        if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
        if (dx > 0) onArchive();
        else onDelete();
      },
      onPanResponderTerminate: reset,
      onPanResponderTerminationRequest: () => true,
    });
  }, [disabled, offset, reduced, onArchive, onDelete]);
  const reviewed = item.investigated_revision === item.revision;
  const status = reviewed ? 'Reviewed' : 'In review';
  const reference = item.id.slice(-6).toUpperCase();
  const title = item.sample ? 'Sample investigation' : 'Hospital bill';
  return <View style={styles.container} {...gesture.panHandlers}>
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={styles.actions}>
      <View style={styles.archiveAction}><AppIcon name={archived ? 'restore' : 'archive'} color={color.onPrimary} size={22} />
        <Text style={styles.actionLabel}>{archived ? 'Restore' : 'Archive'}</Text></View>
      <View style={styles.deleteAction}><AppIcon name="trash-2" color={color.onPrimary} size={22} />
        <Text style={styles.actionLabel}>Delete</Text></View>
    </View>
    <Animated.View style={[styles.row, { transform: [{ translateX: offset }] }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${title}, case ${reference}, ${status}`}
        accessibilityHint="Opens the case. Hold for more actions." disabled={disabled}
        onPress={onOpen} onLongPress={onOptions} style={({ pressed }) => [styles.open, pressed && styles.pressed]}>
        <View style={[styles.stamp, reviewed && styles.finished]}>
          <AppIcon name={reviewed ? 'shield' : 'receipt'} size={26} color={reviewed ? color.primary : color.question} />
        </View>
        <View style={ui.grow}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.meta}><Text style={styles.reference}>#{reference}</Text>
            <View style={[styles.dot, reviewed && styles.finishedDot]} /><Text style={styles.status}>{status}</Text></View>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Options for case ${reference}`}
        disabled={disabled} onPress={onOptions} style={({ pressed }) => [styles.more, pressed && styles.pressed]}>
        <AppIcon name="more" size={23} color={color.muted} />
      </Pressable>
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  row: { alignItems: 'center', flexDirection: 'row', backgroundColor: color.card },
  open: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, minHeight: 84 },
  pressed: { backgroundColor: color.surfaceContainer },
  more: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  stamp: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: color.tertiaryContainer },
  finished: { backgroundColor: color.primaryContainer },
  title: { fontFamily: font.display, fontSize: 24, color: color.ink },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 3 },
  reference: { fontFamily: font.mono, color: color.muted, fontSize: 12 },
  status: { fontFamily: font.medium, color: color.muted, fontSize: 13 },
  dot: { height: 5, width: 5, borderRadius: 3, backgroundColor: color.question, marginStart: 4 },
  finishedDot: { backgroundColor: color.primary },
  actions: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row' },
  archiveAction: { flex: 1, gap: 2, alignItems: 'flex-start', justifyContent: 'center', backgroundColor: color.primary, paddingStart: 12 },
  deleteAction: { flex: 1, gap: 2, alignItems: 'flex-end', justifyContent: 'center', backgroundColor: material.colors.error, paddingEnd: 12 },
  actionLabel: { color: color.onPrimary, fontFamily: font.semibold, fontSize: 12 },
});
