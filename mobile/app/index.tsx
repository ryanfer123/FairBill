import Animated, { ReduceMotion, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { AppIcon, type IconName } from '../src/icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type ScrollViewProps } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScanPreview } from '../src/scan-preview';
import { CaseList } from '../src/cases';
import { ActivityIndicator, TouchableRipple } from 'react-native-paper';
import { documentForm, pickDocument, type PickedDocument, type CaptureMethod } from '../src/document-picker';
import { ConnectionStatus } from '../src/connection';
import { AccountSettings } from '../src/account';
import { cloudBuild } from '../src/cloud-auth';
import { font } from '../src/typography';
import { ApiError, type Case, createCase, forgetCase, getCase, getBackend, hostedBuild, lastCase, money, postCase, rememberCase } from '../src/api';
import { Button, Card, Divider, Input, Mark, Message, SectionHeader, Sheet, color, ui } from '../src/ui';

const destinations = [
  { key: 'cases', title: 'Cases', icon: 'folder' },
  { key: 'check', title: 'New check', icon: 'receipt' },
  { key: 'settings', title: 'Settings', icon: 'settings' },
] as const;
type Destination = typeof destinations[number]['key'];

function TabDock({ current, busy, compact, bottom, onSelect }: { compact: boolean; bottom: number; current: Destination; busy: boolean; onSelect: (tab: Destination) => void }) {
  const { width, fontScale } = useWindowDimensions();
  const narrow = compact && fontScale <= 1.3;
  const dockWidth = Math.min(width * 0.92, 410);
  const size = useAnimatedStyle(() => ({ width: withTiming(narrow ? Math.min(214, dockWidth) : dockWidth, { duration: 200, reduceMotion: ReduceMotion.System }) }));
  const [typing, setTyping] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setTyping(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const index = destinations.findIndex(tab => tab.key === current);
  const slide = useAnimatedStyle(() => ({
    start: withTiming(`${index * 100 / destinations.length}%` as `${number}%`, { duration: 180, reduceMotion: ReduceMotion.System }),
  }));
  if (typing) return null;
  return <Animated.View style={[styles.dock, { bottom }, size]}>
    <View style={styles.tabTrack}>
      <Animated.View pointerEvents="none" style={[styles.selection, slide]} />
      {destinations.map(tab => {
        const selected = tab.key === current;
        const tint = selected ? color.onPrimaryContainer : color.paper;
        return <Pressable key={tab.key} accessibilityRole="tab" accessibilityLabel={tab.title}
          accessibilityState={{ selected, disabled: busy }} disabled={busy} onPress={() => onSelect(tab.key)}
          style={styles.tab}>
          {({ pressed }) => <View style={[styles.tabContents, pressed && styles.tabPressed]}>
            <AppIcon name={tab.icon} selected={selected} color={tint} size={22} />
            {!narrow && <Text style={[styles.tabText, { color: tint }]}>{tab.title}</Text>}
          </View>}
        </Pressable>;
      })}
    </View>
  </Animated.View>;
}

function CaseLink({ title, label, detail, amount, progress, icon, disabled, pending = false, featured = false, onPress }:
  { title: string; label: string; detail?: string; amount?: string; progress?: number; icon: IconName;
    disabled: boolean; pending?: boolean; featured?: boolean; onPress: () => void }) {
  return <TouchableRipple accessibilityRole="button" accessibilityLabel={title === label ? label : `${title}. ${label}`}
    accessibilityHint={[detail, amount, progress != null ? `${progress} of 3 review steps complete` : null].filter(Boolean).join('. ') || undefined}
    accessibilityState={{ disabled, busy: pending }} disabled={disabled} onPress={onPress}>
    <View style={[styles.caseRow, featured && styles.featuredRow]}>
      <View style={[styles.rowIcon, featured && styles.featuredIcon]}>
        <AppIcon name={icon} size={22} color={color.primary} />
      </View>
      <View style={[ui.grow, styles.rowDescription]}>
        <Text style={ui.label}>{title}</Text>
        {!!detail && <Text style={ui.small}>{detail}</Text>}
        {!!amount && <Text style={[ui.money, styles.caseAmount]}>{amount}</Text>}
        {progress != null && <View style={styles.progress} importantForAccessibility="no-hide-descendants">
          {[0, 1, 2].map((step) => <View key={step} style={[styles.progressPart, step < progress && styles.progressComplete]} />)}
        </View>}
      </View>
      {pending ? <ActivityIndicator size="small" color={color.primary} /> : <AppIcon name="chevron-right" size={18} color={color.muted} />}
    </View>
  </TouchableRipple>;
}

export default function Home() {
  const [latest, setLatest] = useState<string | null>(null);
  const [recent, setRecent] = useState<Case | null>(null);
  const [busy, setBusy] = useState<CaptureMethod | 'paste' | 'sample' | null>(null);
  const [scanning, setScanning] = useState<PickedDocument | null>(null);
  const [capture, setCapture] = useState<'upload' | 'paste' | null>(null);
  const [text, setText] = useState('');
  const importing = useRef(false);
  const blank = useRef<{ id: string; revision: number } | null>(null);
  const [error, setError] = useState('');
  const [destination, setDestination] = useState<'cases' | 'check' | 'settings'>('check');
  const { bottom } = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const clearance = bottom + 86 + Math.max(0, fontScale - 1) * 32;
  const [compact, setCompact] = useState(false);
  const anchor = useRef(0);
  useEffect(() => { anchor.current = 0; setCompact(false); }, [destination]);
  const onScroll: NonNullable<ScrollViewProps['onScroll']> = useCallback(({ nativeEvent }) => {
    const limit = Math.max(0, nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height);
    const y = Math.max(0, Math.min(limit, nativeEvent.contentOffset.y));
    if (y <= 2 || Math.abs(y - anchor.current) >= 12) {
      setCompact(y > 2 && y > anchor.current);
      anchor.current = y;
    }
  }, []);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [versioned, setVersioned] = useState(cloudBuild);

  useFocusEffect(useCallback(() => {
    let active = true;
    void lastCase().then(async (id) => {
      if (!active) return;
      setLatest(id);
      setRecent((saved) => saved?.id === id ? saved : null);
      if (id) {
        try {
          const saved = await getCase(id);
          if (active) setRecent(saved);
        } catch (cause) {
          if (cause instanceof ApiError && cause.status === 404 && active) {
            setLatest((current) => current === id ? null : current);
            if (await lastCase() === id) await forgetCase();
          }
        }
      }
    }).catch(() => undefined);
    void getBackend().then((backend) => { if (active) setVersioned(backend.prefix === '/v1'); }).catch(() => undefined);
    return () => { active = false; };
  }, [connectionRevision]));

  const open = (id: string, options?: { document?: string }) =>
    router.push({ pathname: '/case/[id]', params: { id, ...options } });

  async function start(action: CaptureMethod | 'paste' | 'sample') {
    if (importing.current) return;
    importing.current = true;
    setBusy(action);
    setError('');
    try {
      if (action === 'sample') {
        if (cloudBuild) return;
        const created = await createCase(true);
        await rememberCase(created.id);
        open(created.id);
        return;
      }
      if (hostedBuild) return;
      const asset = action !== 'paste' ? await pickDocument(action) : undefined;
      if (action !== 'paste' && !asset) return;
      if (action === 'paste' && !text.trim()) return;
      if (asset) setScanning(asset);
      if (!blank.current) blank.current = await createCase(false);
      const { id, revision } = blank.current;
      const result = asset
        ? await postCase(`/cases/${id}/documents/file`, documentForm('invoice', revision, asset))
        : await postCase(`/cases/${id}/documents/text`, { kind: 'invoice', revision, text });
      blank.current = null;
      await rememberCase(result.id);
      setText('');
      setCapture(null);
      open(result.id, { document: result.documents.at(-1)?.id });
    } catch (cause) {
      if (action !== 'sample' && cause instanceof ApiError && cause.status === 409 && blank.current) {
        try {
          const current = await getCase(blank.current.id);
          const uploaded = current.documents.find((document) => document.kind === 'invoice' && !document.confirmed);
          if (uploaded) {
            blank.current = null;
            await rememberCase(current.id);
            setText('');
            setCapture(null);
            open(current.id, { document: uploaded.id });
            return;
          }
        } catch { /* Show the original request error. */ }
      }
      setError((cause as Error).message);
    } finally {
      setScanning(null);
      setBusy(null);
      importing.current = false;
    }
  }

  function chooseCapture(mode: 'upload' | 'paste') {
    setError('');
    setCapture(mode);
  }

  const reviewed = recent && recent.investigated_revision === recent.revision;
  const hasInvoice = recent?.documents.some((document) => document.kind === 'invoice');
  const allConfirmed = hasInvoice && recent?.documents.every((document) => document.confirmed);
  const progress = !recent ? undefined : reviewed ? 3 : allConfirmed ? 2 : hasInvoice ? 1 : 0;
  const conditionalAmount = reviewed ? recent?.scenario?.conditional : undefined;
  const activeQuestions = reviewed ? recent?.findings.filter((finding) => finding.check !== 'settlement' && finding.status === 'active').length : undefined;
  const recentDetail = conditionalAmount != null ? 'Conditional total'
    : reviewed ? 'Review complete'
    : recent?.documents.some((document) => !document.confirmed) ? 'Confirm document lines'
    : recent?.documents.length ? 'Ready for review'
    : recent ? 'Add a bill to begin' : 'Pick up where you left off';

  return (
    <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
      <View style={[ui.between, styles.appBar]}>
        <View style={ui.row}><Mark size={36} /><Text style={styles.brand}>FairBill</Text></View>
        <Text style={ui.small}>INR · ₹</Text>
      </View>
      {destination === 'check' && <ScrollView style={ui.grow} onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={[ui.content, styles.homeContent, { paddingBottom: clearance }]}>
        {error && !capture ? <Message text={error} onClose={() => setError('')} /> : null}
        {!!latest && <View style={ui.stack}>
          <SectionHeader>{recent && !reviewed ? 'Needs your attention' : 'Recent case'}</SectionHeader>
          <View style={styles.recentCase}>
            <CaseLink title={recent?.sample ? 'Sample investigation' : 'Hospital bill'} label="Resume last case"
              featured icon="receipt" disabled={!!busy} onPress={() => open(latest)}
              progress={progress} detail={activeQuestions ? `${recentDetail} · ${activeQuestions} ${activeQuestions === 1 ? 'question' : 'questions'}` : recentDetail}
              amount={conditionalAmount != null ? money(conditionalAmount) : undefined} />
          </View>
        </View>}
        <View style={styles.scanPanel}>
          <View style={styles.scanTop}>
            <View style={styles.viewfinder} accessible={false} importantForAccessibility="no-hide-descendants">
              <AppIcon name="receipt" size={43} color={color.paper} />
              <View style={styles.cornerStart} /><View style={styles.cornerEnd} />
            </View>
            <Text accessibilityRole="header" style={styles.headline}>Check a hospital bill</Text>
          </View>
          <Text style={styles.scanHint}>{Platform.OS === 'android' ? 'Hold the itemised bill steady with all four corners in view for auto capture.' : 'Start with the page that lists each service and its charge.'}</Text>
          <TouchableRipple accessibilityRole="button" accessibilityState={{ disabled: !!busy, busy: busy === 'camera' }}
            disabled={!!busy} style={styles.scanAction} onPress={hostedBuild ? () => setDestination('settings') : () => void start('camera')}>
            <View style={styles.scanButton}>
              {busy === 'camera' ? <ActivityIndicator size="small" color={color.primary} /> :
                <AppIcon name={hostedBuild ? 'key' : 'camera'} size={22} color={color.primary} />}
              <Text style={[ui.label, styles.scanLabel]}>{hostedBuild ? 'Open tester settings' : 'Scan a bill'}</Text>
              <AppIcon name="arrow-right" size={20} color={color.primary} />
            </View>
          </TouchableRipple>
        </View>
        {!hostedBuild && <View style={ui.stack}>
          <SectionHeader>Other ways to add a bill</SectionHeader>
          <View style={styles.methods}>
            <CaseLink title="Upload a file" label="Upload a file" detail="PDF or photo" icon="upload" disabled={!!busy} onPress={() => chooseCapture('upload')} />
            <Divider />
            <CaseLink title="Paste text" label="Paste text" detail="Copied from an itemised bill" icon="file-text" disabled={!!busy} onPress={() => chooseCapture('paste')} />
          </View>
        </View>}
        {!cloudBuild && <View style={styles.sample}>
          <CaseLink title="Try the sample case" label="Try the sample case" icon="arrow-right" pending={busy === 'sample'}
            detail="Follow a fictional bill from questions to evidence." disabled={!!busy} onPress={() => void start('sample')} />
        </View>}
        <ConnectionStatus refresh={connectionRevision} problemsOnly />
      </ScrollView>}
      {destination === 'cases' && <CaseList onStart={() => setDestination('check')} onScroll={onScroll} clearance={clearance} onOpen={(id) => {
        void rememberCase(id).then(() => open(id)).catch((cause: Error) => {
          setDestination('check'); setError(cause.message);
        });
      }} />}
      {destination === 'settings' && <AccountSettings onScroll={onScroll} clearance={clearance} embedded onClose={() => setDestination('check')} onInvite={() => {
        setConnectionRevision((value) => value + 1);
        setError('');
      }} />}
      {(capture || scanning) && <Sheet title={scanning ? 'Scan document' : capture === 'upload' ? 'Upload a bill' : 'Paste an itemised bill'} onClose={() => {
        if (importing.current) return;
        setCapture(null);
        setError('');
      }}>
        {scanning ? <ScanPreview asset={scanning} /> : <KeyboardAvoidingView style={ui.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
            {error ? <Message text={error} onClose={() => setError('')} /> : null}
            <Text style={ui.body}>Use an itemised bill that lists each service and its charge.</Text>
            <View style={styles.note}>
              <AppIcon name="lock" size={16} color={color.primary} />
              <Text style={[ui.small, ui.grow]}>{cloudBuild ? 'Bills are saved to your private account.' : 'Use fictional documents in this build.'}</Text>
            </View>
            {capture === 'upload' ? <View style={styles.caseList}>
              <CaseLink title="Choose file from device" label="Choose file from device" icon="upload" disabled={!!busy}
                pending={busy === 'file'} onPress={() => void start('file')} />
              <Divider />
              <CaseLink title="Choose existing photo" label="Choose existing photo" icon="image" disabled={!!busy}
                pending={busy === 'photo'} onPress={() => void start('photo')} />
            </View> : <Card>
              <Input label="Itemised bill text" accessibilityLabel="Itemised bill text" value={text} onChangeText={setText}
                multiline editable={!busy} maxLength={20000} style={styles.paste} />
              <Button label="Check pasted bill" icon="arrow-right" busy={busy === 'paste'} disabled={!!busy || !text.trim()} onPress={() => void start('paste')} />
            </Card>}
          </ScrollView>
        </KeyboardAvoidingView>}
      </Sheet>}
      <TabDock compact={compact} bottom={bottom + 8} current={destination} busy={!!busy} onSelect={(tab) => {
          if (tab === 'cases' && !versioned) {
            if (latest) open(latest);
            else setError(cloudBuild ? 'Add a bill to start a case.' : 'Open the sample or add a bill to start a case.');
            return;
          }
          setDestination(tab);
        }} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  appBar: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  brand: { fontFamily: font.display, fontSize: 27, letterSpacing: -0.6, color: color.ink },
  homeContent: { gap: 20, paddingTop: 16 },
  scanPanel: { backgroundColor: color.primary, borderRadius: 26, padding: 22, gap: 16 },
  scanTop: { gap: 17, alignItems: 'flex-start' },
  viewfinder: { height: 56, width: 66, justifyContent: 'center', alignItems: 'center' },
  cornerStart: { position: 'absolute', top: 0, left: 0, width: 17, height: 17, borderLeftWidth: 2, borderTopWidth: 2, borderTopLeftRadius: 6, borderColor: color.inversePrimary },
  cornerEnd: { position: 'absolute', right: 0, bottom: 0, width: 17, height: 17, borderRightWidth: 2, borderBottomWidth: 2, borderBottomRightRadius: 6, borderColor: color.inversePrimary },
  headline: { fontFamily: font.display, fontSize: 44, lineHeight: 45, letterSpacing: -1, color: color.paper },
  scanHint: { fontFamily: font.regular, fontSize: 17, lineHeight: 23, color: color.primaryContainer },
  scanAction: { backgroundColor: color.paper, borderRadius: 15, overflow: 'hidden', marginTop: 3 },
  scanButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 16, gap: 12, minHeight: 52 },
  scanLabel: { color: color.primary, flex: 1 },
  methods: { borderRadius: 18, borderWidth: 1, borderColor: color.line, overflow: 'hidden', backgroundColor: color.card },
  sample: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  recentCase: { borderRadius: 16, backgroundColor: color.card, borderWidth: 1, borderColor: color.line, overflow: 'hidden' },
  caseList: { borderRadius: 20, backgroundColor: color.surfaceContainer, overflow: 'hidden' },
  caseRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 62 },
  featuredRow: { paddingVertical: 16 },
  rowIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  featuredIcon: { backgroundColor: color.secondaryContainer },
  rowDescription: { gap: 2 },
  progress: { flexDirection: 'row', gap: 3, maxWidth: 100, marginTop: 4 },
  progressPart: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.line },
  progressComplete: { backgroundColor: color.primary },
  caseAmount: { fontSize: 24, lineHeight: 30 },
  paste: { minHeight: 144 },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  dock: { alignSelf: 'center', position: 'absolute', zIndex: 2,
    padding: 5, backgroundColor: color.onPrimaryContainer, borderRadius: 34, elevation: 5,
    shadowColor: color.ink, shadowOffset: { width: 0, height: 3 }, shadowRadius: 6, shadowOpacity: 0.17 },
  tabTrack: { flexDirection: 'row', position: 'relative' },
  selection: { position: 'absolute', width: '33.333333%', top: 0, bottom: 0, borderRadius: 28, backgroundColor: color.primaryContainer },
  tab: { flex: 1, minHeight: 49, borderRadius: 28, overflow: 'hidden' },
  tabContents: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 4 },
  tabPressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  tabText: { textAlign: 'center', fontFamily: font.semibold, fontSize: 13 },
});
