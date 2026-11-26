import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import type { PickedDocument } from './document-picker';
import { AppIcon } from './icons';
import { color, ui } from './theme';

export function ScanPreview({ asset }: { asset: PickedDocument }) {
  const [height, setHeight] = useState(0);
  const [failed, setFailed] = useState(false);
  const reduced = useReducedMotion();
  const sweep = useSharedValue(0);
  useEffect(() => {
    sweep.value = reduced ? 0.5 : withRepeat(withTiming(1, { duration: 1650, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(sweep);
  }, [reduced, sweep]);
  const beam = useAnimatedStyle(() => ({ transform: [{ translateY: sweep.value * Math.max(0, height - 14) }] }));
  return <View style={styles.surface} accessibilityLiveRegion="polite">
    <View style={styles.frame} onLayout={event => setHeight(event.nativeEvent.layout.height)}
      importantForAccessibility="no-hide-descendants">
      {asset.type.startsWith('image/') && !failed
        ? <Image source={{ uri: asset.uri }} resizeMode="contain" style={StyleSheet.absoluteFill} onError={() => setFailed(true)} />
        : <View style={styles.page}><AppIcon name="file-text" size={68} color={color.primary} /></View>}
      <View style={[styles.corner, styles.tl]} /><View style={[styles.corner, styles.tr]} />
      <View style={[styles.corner, styles.bl]} /><View style={[styles.corner, styles.br]} />
      <Animated.View style={[styles.beam, beam]} />
    </View>
    <Text accessibilityRole="header" style={ui.heading}>Reading your document</Text>
    <Text style={ui.body}>You can check the extracted lines when it’s ready.</Text>
  </View>;
}

const styles = StyleSheet.create({
  surface: { flex: 1, padding: 24, gap: 12, alignSelf: 'center', width: '100%', maxWidth: 520, justifyContent: 'center' },
  frame: { flexShrink: 1, height: 340, backgroundColor: '#142C24', borderRadius: 16, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  page: { width: '57%', height: '76%', borderRadius: 5, backgroundColor: color.paper, alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 23, height: 23, borderColor: '#ABF4C9' },
  tl: { top: 12, left: 12, borderTopWidth: 3, borderLeftWidth: 3 },
  tr: { top: 12, right: 12, borderTopWidth: 3, borderRightWidth: 3 },
  bl: { bottom: 12, left: 12, borderBottomWidth: 3, borderLeftWidth: 3 },
  br: { bottom: 12, right: 12, borderBottomWidth: 3, borderRightWidth: 3 },
  beam: { position: 'absolute', top: 0, left: 8, right: 8, height: 14, borderBottomWidth: 2, borderColor: '#94FFBF', backgroundColor: 'rgba(147,255,190,0.22)' },
});
