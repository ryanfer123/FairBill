import { AppIcon, type IconName } from '../src/icons';
import { Illustration } from '../src/illustrations';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CaseList } from '../src/cases';
import { ActivityIndicator, BottomNavigation, TouchableRipple } from 'react-native-paper';
import { documentForm, pickDocument, type CaptureMethod } from '../src/document-picker';
import { ConnectionStatus } from '../src/connection';
import { AccountSettings } from '../src/account';
import { cloudBuild } from '../src/cloud-auth';
import { font } from '../src/typography';
import { ApiError, type Case, createCase, forgetCase, getCase, getBackend, hostedBuild, lastCase, money, postCase, rememberCase } from '../src/api';
import { Button, Card, Divider, Input, Mark, Message, Screen, SectionHeader, Sheet, color, ui } from '../src/ui';

const destinations = [
  { key: 'cases', title: 'Cases', icon: 'folder' },
  { key: 'check', title: 'New check', icon: 'receipt' },
  { key: 'settings', title: 'Settings', icon: 'settings' },
] as const;
const navigation = { index: 1, routes: [...destinations] };
const noBarInsets = { bottom: 0, left: 0, right: 0 };

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
  const [capture, setCapture] = useState<'upload' | 'paste' | null>(null);
  const [text, setText] = useState('');
  const importing = useRef(false);
  const blank = useRef<{ id: string; revision: number } | null>(null);
  const [error, setError] = useState('');
  const [destination, setDestination] = useState<'cases' | 'check' | 'settings'>('check');
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
    <Screen>
      <View style={[ui.between, styles.appBar]}>
        <View style={ui.row}><Mark size={36} /><Text style={styles.brand}>FairBill</Text></View>
        <Text style={ui.small}>INR · ₹</Text>
      </View>
      {destination === 'check' && <ScrollView style={ui.grow} contentContainerStyle={[ui.content, styles.homeContent]}>
        {error && !capture ? <Message text={error} onClose={() => setError('')} /> : null}
        <View style={styles.intro}>
          <View style={[ui.between, styles.hero]}>
            <View style={[ui.grow, ui.stack]}>
              <Text accessibilityRole="header" accessibilityLabel="Check a hospital bill" style={ui.title}>
                Don’t pay what you <Text style={styles.heroAccent}>don’t owe.</Text>
              </Text>
              <Text style={ui.body}>Check hospital bills against your records.</Text>
            </View>
            <Illustration name="receipt" size={80} />
          </View>
          {hostedBuild ? <Button label="Open tester settings" icon="key" tone="ghost" onPress={() => setDestination('settings')} />
            : <View style={styles.captureActions}>
              <View style={styles.captureButton}><Button label="Scan a bill" icon="camera" busy={busy === 'camera'}
                disabled={!!busy} onPress={() => void start('camera')} /></View>
              <View style={styles.captureButton}><Button label="Upload a file" icon="upload" tone="ghost"
                disabled={!!busy} onPress={() => chooseCapture('upload')} /></View>
            </View>}
          {!hostedBuild && <View style={styles.pasteRow}>
            <Button label="Paste text" icon="file-text" tone="light" disabled={!!busy} onPress={() => chooseCapture('paste')} />
          </View>}
        </View>
        {!!latest && <View style={ui.stack}>
          <SectionHeader>{recent && !reviewed ? 'Needs your attention' : 'Recent case'}</SectionHeader>
          <View style={styles.recentCase}>
            <CaseLink title={recent?.sample ? 'Sample investigation' : 'Hospital bill'} label="Resume last case"
              featured icon="receipt" disabled={!!busy} onPress={() => open(latest)}
              progress={progress} detail={activeQuestions ? `${recentDetail} · ${activeQuestions} ${activeQuestions === 1 ? 'question' : 'questions'}` : recentDetail}
              amount={conditionalAmount != null ? money(conditionalAmount) : undefined} />
          </View>
        </View>}
        {!cloudBuild && <View style={styles.sample}>
          <CaseLink title="Try the sample case" label="Try the sample case" icon="arrow-right" pending={busy === 'sample'}
            detail="Follow a fictional bill from questions to evidence." disabled={!!busy} onPress={() => void start('sample')} />
        </View>}
        <ConnectionStatus refresh={connectionRevision} problemsOnly />
      </ScrollView>}
      {destination === 'cases' && <CaseList onOpen={(id) => {
        void rememberCase(id).then(() => open(id)).catch((cause: Error) => {
          setDestination('check'); setError(cause.message);
        });
      }} />}
      {destination === 'settings' && <AccountSettings embedded onClose={() => setDestination('check')} onInvite={() => {
        setConnectionRevision((value) => value + 1);
        setError('');
      }} />}
      {capture && <Sheet title={capture === 'upload' ? 'Upload a bill' : 'Paste an itemised bill'} onClose={() => {
        if (importing.current) return;
        setCapture(null);
        setError('');
      }}>
        <KeyboardAvoidingView style={ui.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
        </KeyboardAvoidingView>
      </Sheet>}
      <BottomNavigation.Bar navigationState={{ ...navigation, index: destinations.findIndex((route) => route.key === destination) }} safeAreaInsets={noBarInsets}
        keyboardHidesNavigationBar getAccessibilityLabel={({ route }) => route.title}
        activeIndicatorStyle={styles.navIndicator}
        activeColor={color.onSecondaryContainer} inactiveColor={color.muted}
        renderIcon={({ route, color: tint }) => <AppIcon name={route.icon} size={24} color={tint} />}
        onTabPress={({ route, preventDefault }) => {
          if (busy) { preventDefault(); return; }
          if (route.key === 'cases' && !versioned) {
            if (latest) open(latest);
            else setError(cloudBuild ? 'Add a bill to start a case.' : 'Open the sample or add a bill to start a case.');
            return;
          }
          setDestination(route.key);
        }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  appBar: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  brand: { fontFamily: font.display, fontSize: 27, letterSpacing: -0.6, color: color.ink },
  homeContent: { gap: 20, paddingTop: 16 },
  intro: { gap: 9 },
  hero: { alignItems: 'flex-start', paddingTop: 6, paddingBottom: 6 },
  heroAccent: { color: color.primary },
  captureActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  captureButton: { flexGrow: 1, flexBasis: 140, minWidth: 0 },
  pasteRow: { alignSelf: 'flex-start' },
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
  navIndicator: { width: 56, height: 32, borderRadius: 16 },
});
