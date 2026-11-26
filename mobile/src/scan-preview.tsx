import { useFairBillTheme, themedStyles } from './theme';
import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import type { PickedDocument } from './document-picker';
import { Illustration } from './illustrations';
import { surfaceReveal } from './motion';
import { ActionBar, Button, LoadingState, Message } from './ui';

export type ScanStage = 'preparing' | 'reading' | 'processing';

const copy = {
  preparing: { title: 'Preparing the file', detail: 'Getting the selected document ready to read.' },
  reading: { title: 'Reading the image on this phone', detail: 'Looking for text in the captured page.' },
  processing: { title: 'Extracting document lines', detail: 'You’ll compare the extracted lines with your bill next.' },
  discarding: { title: 'Discarding the import', detail: 'Clearing this import from the case.' },
};

export type ImportRecovery = {
  message: string;
  onRetry: () => void;
  onReplace: () => void;
  replaceLabel: string;
  onPaste: () => void;
};

function recoveryTitle(message: string) {
  if (/could not reach|connection|offline/i.test(message)) return 'Connection interrupted';
  if (/no readable|unreadable|invalid (?:image|pdf)|could not decode/i.test(message)) return 'The file couldn’t be read';
  return 'The import couldn’t finish';
}

function ViewfinderCorners() {
  const { color } = useFairBillTheme();
  return <Svg viewBox="0 0 256 256" width="100%" height="100%" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
    <Path d="M14 39V22Q14 14 22 14H39M217 14H234Q242 14 242 22V39M242 217V234Q242 242 234 242H217M39 242H22Q14 242 14 234V217"
      fill="none" stroke={color.scanCorners} strokeWidth={2} strokeLinecap="round" />
  </Svg>;
}

export function ScanPreview({ asset, stage, discarding, onDiscard, recovery }:
  { asset: PickedDocument; stage: ScanStage; discarding: boolean; onDiscard: () => void; recovery?: ImportRecovery }) {
  const { ui } = useFairBillTheme();
  const styles = useStyles();
  const [failedPreview, setFailedPreview] = useState(false);
  const status = discarding ? 'discarding' : stage;
  const { title, detail } = copy[status];
  const showPhoto = asset.type.startsWith('image/') && !failedPreview;
  return <View style={ui.grow}>
    <ScrollView contentContainerStyle={[ui.content, styles.content]}>
      <Animated.View entering={surfaceReveal} style={styles.frame}
        accessibilityLabel={showPhoto ? 'Selected bill image' : 'Selected document'} accessible>
        {showPhoto ? <Image source={{ uri: asset.uri }} resizeMode="contain" style={styles.photo}
          onError={() => setFailedPreview(true)} /> : <Illustration name="scan" size={100} />}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}><ViewfinderCorners /></View>
      </Animated.View>
      {recovery ? <>
        <Text accessibilityRole="header" style={ui.heading}>{recoveryTitle(recovery.message)}</Text>
        <Message text={recovery.message} />
        <Button label={recovery.replaceLabel} tone="light" onPress={recovery.onReplace} />
        <Button label="Type it manually" tone="ghost" onPress={recovery.onPaste} />
      </> : <>
        <LoadingState label={title} />
        <Text style={ui.body}>{detail}</Text>
      </>}
    </ScrollView>
    <ActionBar>{recovery
      ? <Button label="Retry this file" icon="refresh-cw" onPress={recovery.onRetry} />
      : <Button label="Discard import" icon="x" tone="ghost" disabled={discarding} onPress={onDiscard} />}</ActionBar>
  </View>;
}

const useStyles = themedStyles(({ color }) => StyleSheet.create({
  content: { maxWidth: 500, paddingTop: 24 },
  frame: { aspectRatio: 1.05, maxHeight: 330, backgroundColor: color.scanFrame, borderRadius: 22,
    overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  photo: { width: '91%', height: '91%' },
}));
