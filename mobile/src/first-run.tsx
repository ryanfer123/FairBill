import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button as PaperButton } from 'react-native-paper';
import * as SecureStore from 'expo-secure-store';
import { AppIcon, type IconName } from './icons';
import { Button, Mark, Screen, color, ui } from './ui';
import { font } from './typography';

const completedKey = 'fairbill_intro_completed_v1';
const steps: { icon: IconName; title: string; detail: string }[] = [
  { icon: 'camera', title: 'Add your bill', detail: 'Take a clear photo or choose a document from your phone.' },
  { icon: 'edit-2', title: 'Check what we read', detail: 'Compare each line with your bill and correct anything we misread.' },
  { icon: 'message-circle', title: 'Ask about a charge', detail: 'Review the evidence and decide what to share with billing.' },
];

function BillArtwork() {
  return <View style={s.art} accessible={false} importantForAccessibility="no-hide-descendants">
    <View style={s.orbit} />
    <View style={s.sheetBehind} />
    <View style={s.receipt}>
      <Text allowFontScaling={false} style={s.receiptTitle}>Hospital bill</Text>
      <View style={s.rule} />
      {[58, 86, 64].map(width => <View key={width} style={ui.between}>
        <View style={[s.line, { width }]} /><View style={[s.line, { width: 24 }]} />
      </View>)}
      <View style={s.rule} /><View style={ui.between}><View style={[s.line, { width: 36 }]} /><Text allowFontScaling={false} style={s.rupee}>₹</Text></View>
    </View>
    <View style={s.lens}><AppIcon name="search" size={47} color={color.primary} /></View>
  </View>;
}

export function FirstRun({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<'loading' | 'welcome' | 'guide' | 'done'>('loading');
  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(completedKey).then(value => {
      if (active) setPage(value === '1' ? 'done' : 'welcome');
    }).catch(() => { if (active) setPage('welcome'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (page !== 'guide') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { setPage('welcome'); return true; });
    return () => listener.remove();
  }, [page]);
  function finish() {
    setPage('done');
    void SecureStore.setItemAsync(completedKey, '1').catch(() => {
      // The guide remains dismissible when device storage is temporarily unavailable.
    });
  }
  if (page === 'loading') return <Screen><View /></Screen>;
  if (page === 'done') return <>{children}</>;
  const welcome = page === 'welcome';
  return <Screen><ScrollView key={page} contentContainerStyle={s.page}>
    <View style={s.bar}>
      <View style={ui.row}><Mark size={32} /><Text style={s.brand}>FairBill</Text></View>
      <PaperButton onPress={welcome ? finish : () => setPage('welcome')} contentStyle={s.tap}>{welcome ? 'Skip intro' : 'Back'}</PaperButton>
    </View>
    <View style={s.middle}>
      {welcome && <BillArtwork />}
      <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={s.title}>{welcome ? 'Make sense of your hospital bill.' : 'Your first bill review'}</Text>
      {welcome ? <Text style={s.body}>Look through the charges, find the lines worth asking about, and take your questions to billing.</Text>
        : steps.map(step => <View key={step.title} style={s.step}>
          <View style={s.icon}><AppIcon name={step.icon} size={24} color={color.primary} /></View>
          <View style={ui.grow}><Text style={ui.label}>{step.title}</Text><Text style={ui.body}>{step.detail}</Text></View>
        </View>)}
    </View>
    <Button label={welcome ? 'See how it works' : 'Get started'} icon="arrow-right" onPress={welcome ? () => setPage('guide') : finish} />
  </ScrollView></Screen>;
}

const s = StyleSheet.create({
  page: { flexGrow: 1, width: '100%', maxWidth: 540, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 8, paddingBottom: 22, gap: 20 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
  brand: { color: color.primary, fontFamily: font.display, fontSize: 28 },
  tap: { minHeight: 48 },
  middle: { flexGrow: 1, justifyContent: 'center', gap: 18, paddingVertical: 8 },
  title: { fontFamily: font.display, color: color.ink, fontSize: 48, lineHeight: 49, letterSpacing: -1.2 },
  body: { ...ui.body, fontSize: 18, lineHeight: 26 },
  art: { backgroundColor: color.primaryContainer, borderRadius: 28, height: 218, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  orbit: { position: 'absolute', height: 320, width: 320, borderRadius: 160, borderWidth: 1, borderColor: '#B4D1C0' },
  sheetBehind: { position: 'absolute', width: 152, height: 165, borderRadius: 3, backgroundColor: '#B3CDBA', transform: [{ rotate: '8deg' }, { translateX: 9 }] },
  receipt: { width: 158, padding: 16, gap: 10, backgroundColor: color.paper, transform: [{ rotate: '-7deg' }], borderRadius: 3 },
  receiptTitle: { fontFamily: font.display, color: color.primary, fontSize: 21 },
  rule: { backgroundColor: color.line, height: 1 },
  line: { backgroundColor: '#ADBCAD', height: 4, borderRadius: 2 },
  rupee: { color: color.primary, fontFamily: font.bold, fontSize: 19 },
  lens: { position: 'absolute', marginLeft: 132, marginTop: 94, borderRadius: 32, width: 64, height: 64, alignItems: 'center', justifyContent: 'center', backgroundColor: color.tertiaryContainer, borderColor: color.primary, borderWidth: 2 },
  step: { flexDirection: 'row', gap: 16, alignItems: 'flex-start', borderTopWidth: 1, borderColor: color.line, paddingTop: 18 },
  icon: { backgroundColor: color.primaryContainer, borderRadius: 14, width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
