import { useFairBillTheme, themedStyles } from '../src/theme';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { AppIcon, type IconName } from '../src/icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type ScrollViewProps } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { ScanPreview, type ScanStage } from '../src/scan-preview';
import { Illustration } from '../src/illustrations';
import { CaseList } from '../src/cases';
import { ActivityIndicator, TouchableRipple } from 'react-native-paper';
import { documentForm, pickDocument, type PickedDocument, type CaptureMethod } from '../src/document-picker';
import { ConnectionStatus } from '../src/connection';
import { rememberDocumentPreview } from '../src/document-preview';
import { dockTiming, highlightReveal, surfaceReveal } from '../src/motion';
import { AccountSettings } from '../src/account';
import { FirstBillGuide, useFirstBillGuide } from '../src/first-run';
import { GuestReview } from '../src/guest-review';
import { cloudBuild } from '../src/cloud-auth';
import { font } from '../src/typography';
import { ApiError, type Case, createCase, deleteCase, forgetCase, getCase, getBackend, hostedBuild, lastCase, money, postCase, rememberCase } from '../src/api';
import { Button, Card, Divider, Input, Message, SectionHeader, Sheet } from '../src/ui';

const destinations = [
  { key: 'cases', title: 'Cases', icon: 'folder' },
  { key: 'check', title: 'New check', icon: 'receipt' },
  { key: 'settings', title: 'Settings', icon: 'settings' },
] as const;
type Destination = typeof destinations[number]['key'];

function TabDock({ current, busy, compact, bottom, typing, onSelect }: { compact: boolean; bottom: number; current: Destination; busy: boolean; typing: boolean; onSelect: (tab: Destination) => void }) {
  const { color, dark } = useFairBillTheme();
  const styles = useStyles();
  const { width, fontScale } = useWindowDimensions();
  const narrow = compact && fontScale <= 1.3;
  const dockWidth = Math.min(width * 0.92, 410);
  const size = useAnimatedStyle(() => ({ width: withTiming(narrow ? Math.min(214, dockWidth) : dockWidth, dockTiming) }));
  const index = destinations.findIndex(tab => tab.key === current);
  const slide = useAnimatedStyle(() => ({
    start: withTiming(`${index * 100 / destinations.length}%` as `${number}%`, dockTiming),
  }));
  if (typing) return null;
  return <Animated.View style={[styles.dockPosition, { bottom }, size]}>
    <View style={[styles.dockSurround, { bottom: -bottom }]} pointerEvents="none" accessible={false}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="dock-surround" cx="50%" cy="53%" rx="50%" ry="52%">
            <Stop offset="0%" stopColor={color.card} stopOpacity={dark ? 0.68 : 0.96} />
            <Stop offset="62%" stopColor={color.card} stopOpacity={dark ? 0.42 : 0.68} />
            <Stop offset="100%" stopColor={color.card} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#dock-surround)" />
      </Svg>
    </View>
    <View style={styles.dock}>
      <View style={styles.tabTrack}>
        <Animated.View pointerEvents="none" style={[styles.selection, slide]} />
        {destinations.map(tab => {
          const selected = tab.key === current;
          const tint = selected ? color.primary : color.muted;
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
    </View>
  </Animated.View>;
}

function CaseLink({ title, label, detail, amount, progress, icon, disabled, pending = false, featured = false, onPress }:
  { title: string; label: string; detail?: string; amount?: string; progress?: number; icon: IconName;
    disabled: boolean; pending?: boolean; featured?: boolean; onPress: () => void }) {
  const { color, ui } = useFairBillTheme();
  const styles = useStyles();
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
  const { ui, color } = useFairBillTheme();
  const styles = useStyles();
  const [latest, setLatest] = useState<string | null>(null);
  const [latestReady, setLatestReady] = useState(false);
  const [recent, setRecent] = useState<Case | null>(null);
  const [busy, setBusy] = useState<CaptureMethod | 'paste' | 'sample' | null>(null);
  const [scanning, setScanning] = useState<PickedDocument | null>(null);
  const [failedFile, setFailedFile] = useState<{ method: CaptureMethod; asset: PickedDocument; message: string }>();
  const [guest, setGuest] = useState(false);
  const [capture, setCapture] = useState<'upload' | 'paste' | null>(null);
  const [text, setText] = useState('');
  const importing = useRef(false);
  const committedImport = useRef(false);
  const discarded = useRef(false);
  const uploadControl = useRef<AbortController | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [scanStage, setScanStage] = useState<ScanStage>('preparing');
  function discardImport() {
    if (!importing.current || committedImport.current) return;
    discarded.current = true;
    uploadControl.current?.abort();
    setDiscarding(true);
  }
  const blank = useRef<{ id: string; revision: number } | null>(null);
  const [error, setError] = useState('');
  const [destination, setDestination] = useState<'cases' | 'check' | 'settings'>('check');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const guide = useFirstBillGuide(cloudBuild && latestReady && latest === null && !busy);
  const { bottom } = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const [typing, setTyping] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setTyping(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  // Keep the dock outside the scrolling viewport so it can't cover an actionable row.
  const dockSpace = typing ? 0 : bottom + 78 + Math.max(0, fontScale - 1) * 32;
  const scrollEndSpacing = 16;
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
      setLatestReady(true);
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

  async function start(action: CaptureMethod | 'paste' | 'sample', selected?: PickedDocument) {
    if (importing.current) return;
    importing.current = true;
    committedImport.current = false;
    discarded.current = false;
    setDiscarding(false);
    setBusy(action);
    setError('');
    let asset = selected;
    try {
      if (action === 'sample') {
        if (cloudBuild) return;
        const created = await createCase(true);
        await rememberCase(created.id);
        open(created.id);
        return;
      }
      if (hostedBuild) return;
      if (action !== 'paste' && !asset) asset = await pickDocument(action);
      if (action !== 'paste' && !asset) return;
      if (action === 'paste' && !text.trim()) return;
      if (asset) { setFailedFile(undefined); setScanStage('preparing'); setScanning(asset); }
      if (!blank.current) blank.current = await createCase(false);
      if (discarded.current) return;
      const { id, revision } = blank.current;
      const form = asset ? await documentForm('invoice', revision, asset, () => setScanStage('reading')) : undefined;
      if (discarded.current) return;
      if (form) setScanStage('processing');
      uploadControl.current = new AbortController();
      const signal = uploadControl.current.signal;
      const result = form
        ? await postCase(`/cases/${id}/documents/file`, form, undefined, signal)
        : await postCase(`/cases/${id}/documents/text`, { kind: 'invoice', revision, text }, undefined, signal);
      if (discarded.current) return;
      committedImport.current = true;
      blank.current = null;
      await rememberCase(result.id).catch(() => undefined);
      setText('');
      setCapture(null);
      const imported = result.documents.at(-1);
      if (asset && imported) rememberDocumentPreview(result.id, imported.id, asset);
      open(result.id, { document: imported?.id });
    } catch (cause) {
      if (discarded.current) return;
      if (action !== 'sample' && cause instanceof ApiError && cause.status === 409 && blank.current) {
        try {
          const current = await getCase(blank.current.id);
          const uploaded = current.documents.find((document) => document.kind === 'invoice' && !document.confirmed);
          if (discarded.current) return;
          if (uploaded) {
            committedImport.current = true;
            blank.current = null;
            await rememberCase(current.id).catch(() => undefined);
            setText('');
            setCapture(null);
            open(current.id, { document: uploaded.id });
            return;
          }
        } catch { /* Show the original request error. */ }
      }
      const message = (cause as Error).message;
      if (asset && action !== 'paste' && action !== 'sample') setFailedFile({ method: action, asset, message });
      else setError(message);
    } finally {
      if (discarded.current) {
        const current = blank.current;
        blank.current = null;
        setCapture(null);
        setText('');
        try {
          if (current) await deleteCase(current.id);
        } catch {
          setError('Could not finish discarding this case. Open Cases and delete case ' + current?.id.slice(-6).toUpperCase() + ' to retry.');
        }
      }
      uploadControl.current = null;
      setDiscarding(false);
      setScanning(null);
      setBusy(null);
      importing.current = false;
    }
  }

  function chooseCapture(mode: 'upload' | 'paste') {
    setError('');
    setFailedFile(undefined);
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
    <SafeAreaView style={[ui.safe, { paddingBottom: dockSpace }]} edges={['top', 'left', 'right']}>
      <View style={[ui.between, styles.appBar]}>
        <Text accessibilityRole="header" style={styles.brand}>Fair<Text style={styles.brandAccent}>Bill</Text></Text>
        <View style={styles.headerActions}>
          {!hostedBuild && <Pressable accessibilityRole="button" accessibilityLabel="Open bill scanner"
            disabled={!!busy} accessibilityState={{ disabled: !!busy }} onPress={() => { setDestination('check'); void start('camera'); }}
            style={({ pressed }) => [styles.headerAction, pressed && styles.headerPressed]}>
            <AppIcon name="maximize" color={color.ink} size={26} />
          </Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel="Open account settings"
            disabled={!!busy} accessibilityState={{ disabled: !!busy }} onPress={() => { setArchiveOpen(false); setDestination('settings'); }}
            style={({ pressed }) => [styles.headerAction, pressed && styles.headerPressed]}>
            <AppIcon name="user" color={color.ink} size={25} />
          </Pressable>
        </View>
      </View>
      {destination === 'check' && <ScrollView style={ui.grow} onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={[ui.content, styles.homeContent, { paddingBottom: scrollEndSpacing }]}>
        {error && !capture ? <Message text={error} onClose={() => setError('')} /> : null}
        <Animated.View entering={highlightReveal}>
          <Text accessibilityRole="header" style={styles.summaryTitle}>Summary</Text>
        </Animated.View>
        {!!latest && <Animated.View entering={surfaceReveal} style={ui.stack}>
          <SectionHeader>{recent && !reviewed ? 'Needs your attention' : 'Recent case'}</SectionHeader>
          <View style={styles.recentCase}>
            <CaseLink title={recent?.sample ? 'Sample investigation' : 'Hospital bill'} label={reviewed ? 'See findings' : recent?.documents.some(doc => !doc.confirmed) ? 'Confirm bill lines'
                : recent?.documents.length ? 'Continue bill review' : 'Open case'}
              featured icon="receipt" disabled={!!busy} onPress={() => open(latest)}
              progress={progress} detail={activeQuestions ? `${recentDetail} · ${activeQuestions} ${activeQuestions === 1 ? 'question' : 'questions'}` : recentDetail}
              amount={conditionalAmount != null ? money(conditionalAmount) : undefined} />
          </View>
        </Animated.View>}
        <Animated.View entering={surfaceReveal} style={styles.scanPanel}>
          <View style={styles.scanTop}>
            <Illustration name="scan" size={54} />
            <Text accessibilityRole="header" style={styles.headline}>Check a hospital bill</Text>
          </View>
          <Text style={styles.scanHint}>{Platform.OS === 'android' ? 'Use the page that lists each charge. After scanning, you’ll confirm the amounts before FairBill checks them.' : 'Use the page that lists each charge. You’ll confirm the amounts before FairBill checks them.'}</Text>
          <TouchableRipple accessibilityRole="button" accessibilityState={{ disabled: !!busy, busy: busy === 'camera' }}
            disabled={!!busy} style={styles.scanAction} onPress={hostedBuild ? () => setDestination('settings') : () => void start('camera')}>
            <View style={styles.scanButton}>
              {busy === 'camera' ? <ActivityIndicator size="small" color={color.primary} /> :
                <AppIcon name={hostedBuild ? 'key' : 'camera'} size={22} color={color.primary} />}
              <Text style={[ui.label, styles.scanLabel]}>{hostedBuild ? 'Open tester settings' : 'Scan a bill'}</Text>
              <AppIcon name="arrow-right" size={20} color={color.primary} />
            </View>
          </TouchableRipple>
        </Animated.View>
        {guide.visible && <FirstBillGuide onDismiss={guide.dismiss} />}
        {!hostedBuild && <View style={ui.stack}>
          <SectionHeader>Other ways to add a bill</SectionHeader>
          <View style={styles.methods}>
            <CaseLink title="Upload a file" label="Upload a file" detail="PDF or photo" icon="upload" disabled={!!busy} onPress={() => chooseCapture('upload')} />
            <Divider />
            <CaseLink title="Paste text" label="Paste text" detail="Copied from an itemised bill" icon="file-text" disabled={!!busy} onPress={() => chooseCapture('paste')} />
            {cloudBuild && <><Divider />
              <CaseLink title="Enter charges manually" label="Enter charges manually" detail="Check the total without uploading anything"
                icon="receipt" disabled={!!busy} onPress={() => setGuest(true)} />
            </>}
          </View>
        </View>}
        {!cloudBuild && <View style={styles.sample}>
          <CaseLink title="Try the sample case" label="Try the sample case" icon="arrow-right" pending={busy === 'sample'}
            detail="Follow a fictional bill from questions to evidence." disabled={!!busy} onPress={() => void start('sample')} />
        </View>}
        <ConnectionStatus refresh={connectionRevision} problemsOnly />
      </ScrollView>}
      {(destination === 'cases' || (destination === 'settings' && archiveOpen)) && <CaseList key={archiveOpen ? 'archive' : 'inbox'}
        onBack={archiveOpen ? () => setArchiveOpen(false) : undefined} onDeleted={id => {
        if (latest === id) { setLatest(null); setRecent(null); void forgetCase().catch(() => undefined); }
        if (blank.current?.id === id) blank.current = null;
      }} onStart={() => setDestination('check')} onScroll={onScroll} clearance={scrollEndSpacing} onOpen={(id) => {
        void rememberCase(id).then(() => open(id)).catch((cause: Error) => {
          setDestination('check'); setError(cause.message);
        });
      }} />}
      {destination === 'settings' && !archiveOpen && <AccountSettings onArchive={versioned ? () => setArchiveOpen(true) : undefined} onScroll={onScroll} clearance={scrollEndSpacing} embedded onClose={() => setDestination('check')} onInvite={() => {
        setConnectionRevision((value) => value + 1);
        setError('');
      }} />}
      {guest && <GuestReview onClose={() => setGuest(false)} onAdopted={(adopted) => {
        setGuest(false);
        void rememberCase(adopted.id).catch(() => undefined);
        open(adopted.id, { document: adopted.documents[0]?.id });
      }} />}
      {(capture || scanning || failedFile) && <Sheet title={scanning || failedFile ? 'Read document' : capture === 'upload' ? 'Upload a bill' : 'Paste an itemised bill'} onClose={() => {
        if (importing.current) return;
        setCapture(null);
        setFailedFile(undefined);
        setError('');
      }}>
        {scanning ? <ScanPreview asset={scanning} stage={scanStage} discarding={discarding} onDiscard={discardImport} />
          : failedFile ? <ScanPreview asset={failedFile.asset} stage={scanStage} discarding={false} onDiscard={discardImport}
            recovery={{ message: failedFile.message, replaceLabel: failedFile.method === 'camera' ? 'Retake photo' : 'Choose another file',
              onRetry: () => void start(failedFile.method, failedFile.asset),
              onReplace: () => failedFile.method === 'camera' ? void start('camera') : chooseCapture('upload'),
              onPaste: () => chooseCapture('paste') }} />
          : <KeyboardAvoidingView style={ui.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
            {error ? <Message text={error} onClose={() => setError('')} /> : null}
            <Text style={ui.body}>Choose the page that lists each service and its charge. You’ll confirm the extracted amounts next.</Text>
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
              <Button label="Read bill lines" icon="arrow-right" busy={busy === 'paste'} disabled={!!busy || !text.trim()} onPress={() => void start('paste')} />
              {busy === 'paste' && <Button label="Discard import" tone="ghost" disabled={discarding} onPress={discardImport} />}
            </Card>}
          </ScrollView>
        </KeyboardAvoidingView>}
      </Sheet>}
      <TabDock compact={compact} typing={typing} bottom={bottom + 8} current={destination} busy={!!busy} onSelect={(tab) => {
          if (tab === 'cases' && !versioned) {
            if (latest) open(latest);
            else setError(cloudBuild ? 'Add a bill to start a case.' : 'Open the sample or add a bill to start a case.');
            return;
          }
          setArchiveOpen(false);
          setDestination(tab);
        }} />
    </SafeAreaView>
  );
}

const useStyles = themedStyles(({ color, ui }) => StyleSheet.create({
  appBar: { minHeight: 58, paddingStart: 18, paddingEnd: 8, paddingVertical: 4, backgroundColor: color.paper,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  brand: { flexShrink: 1, fontFamily: font.uiSans, fontSize: 32, letterSpacing: -1.4, color: color.ink },
  brandAccent: { color: color.primary },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  headerAction: { alignItems: 'center', justifyContent: 'center', minWidth: 46, minHeight: 46, borderRadius: 23 },
  headerPressed: { backgroundColor: color.surfaceContainer },
  homeContent: { gap: 20, paddingTop: 16 },
  summaryTitle: { ...ui.title, fontFamily: font.uiSans, fontSize: 36, lineHeight: 42 },
  scanPanel: { backgroundColor: color.card, borderColor: color.line, borderWidth: StyleSheet.hairlineWidth, borderRadius: 24, padding: 20, gap: 13 },
  scanTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  headline: { flex: 1, fontFamily: font.uiSans, fontSize: 29, lineHeight: 35, letterSpacing: -0.7, color: color.ink },
  scanHint: { fontFamily: font.regular, fontSize: 17, lineHeight: 23, color: color.muted },
  scanAction: { backgroundColor: color.primaryContainer, borderRadius: 15, overflow: 'hidden', marginTop: 3 },
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
  dockPosition: { alignSelf: 'center', position: 'absolute', zIndex: 2, overflow: 'visible' },
  dockSurround: { position: 'absolute', top: -38, left: -28, right: -28 },
  dock: { padding: 5, backgroundColor: color.card, borderRadius: 34, elevation: 5,
    shadowColor: color.ink, shadowOffset: { width: 0, height: 3 }, shadowRadius: 6, shadowOpacity: 0.17 },
  tabTrack: { flexDirection: 'row', position: 'relative' },
  selection: { position: 'absolute', width: '33.333333%', top: 0, bottom: 0, borderRadius: 28, backgroundColor: color.primaryContainer },
  tab: { flex: 1, minHeight: 49, borderRadius: 28, overflow: 'hidden' },
  tabContents: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 4 },
  tabPressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  tabText: { textAlign: 'center', fontFamily: font.semibold, fontSize: 13 },
}));
