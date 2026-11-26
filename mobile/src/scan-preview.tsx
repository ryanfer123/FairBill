import { useFairBillTheme, themedStyles } from './theme';
import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import type { PickedDocument } from './document-picker';
import { Illustration } from './illustrations';
import { evidenceReveal, surfaceReveal } from './motion';
import { ActionBar, Button } from './ui';

export type ScanStage = 'preparing' | 'reading' | 'processing';

const copy = {
  preparing: { title: 'Preparing your document', detail: 'Getting the original ready for review.', icon: 'scan' },
  reading: { title: 'Reading text on your phone', detail: 'FairBill is looking for the lines on this image.', icon: 'scan' },
  processing: { title: 'Extracting document lines', detail: 'You’ll review the lines alongside their source.', icon: 'confirm' },
  discarding: { title: 'Discarding this import', detail: 'FairBill is clearing the pending import.', icon: 'scan' },
} as const;

function ViewfinderCorners() {
  const { color } = useFairBillTheme();
  return <Svg viewBox="0 0 256 256" width="100%" height="100%" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
    <Path d="M14 39V22Q14 14 22 14H39M217 14H234Q242 14 242 22V39M242 217V234Q242 242 234 242H217M39 242H22Q14 242 14 234V217"
      fill="none" stroke={color.scanCorners} strokeWidth={2} strokeLinecap="round" />
  </Svg>;
}

export function ScanPreview({ asset, stage, discarding, onDiscard }:
  { asset: PickedDocument; stage: ScanStage; discarding: boolean; onDiscard: () => void }) {
  const { ui } = useFairBillTheme();
  const styles = useStyles();
  const [failed, setFailed] = useState(false);
  const status = discarding ? 'discarding' : stage;
  const { title, detail, icon } = copy[status];
  const showPhoto = asset.type.startsWith('image/') && !failed;
  return <View style={ui.grow}>
    <ScrollView contentContainerStyle={[ui.content, styles.content]}>
      <Animated.View entering={surfaceReveal} style={styles.frame} accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {showPhoto ? <Image source={{ uri: asset.uri }} resizeMode="contain" style={styles.photo}
          onError={() => setFailed(true)} /> : <Illustration name="scan" size={100} />}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}><ViewfinderCorners /></View>
      </Animated.View>
      <View accessibilityLiveRegion="polite">
        <Animated.View key={status} entering={evidenceReveal} style={styles.status}>
          <Illustration name={icon} size={42} />
          <View style={ui.grow}>
            <Text accessibilityRole="header" style={ui.heading}>{title}</Text>
            <Text style={ui.body}>{detail}</Text>
          </View>
        </Animated.View>
      </View>
    </ScrollView>
    <ActionBar><Button label="Discard import" icon="x" tone="ghost" disabled={discarding} onPress={onDiscard} /></ActionBar>
  </View>;
}

const useStyles = themedStyles(({ color }) => StyleSheet.create({
  content: { maxWidth: 500, paddingTop: 24 },
  frame: { aspectRatio: 1.05, maxHeight: 330, backgroundColor: color.scanFrame, borderRadius: 22,
    overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  photo: { width: '91%', height: '91%' },
  status: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
}));
