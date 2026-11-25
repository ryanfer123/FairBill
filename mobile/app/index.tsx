import { AppIcon, type IconName } from '../src/icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CaseList } from '../src/cases';
import { ActivityIndicator, BottomNavigation, SegmentedButtons, TouchableRipple } from 'react-native-paper';
import { CaptureOptions } from '../src/capture-options';
import { documentForm, pickDocument, type CaptureMethod } from '../src/document-picker';
import { ConnectionStatus } from '../src/connection';
import { AccountSettings } from '../src/account';
import { cloudBuild } from '../src/cloud-auth';
import { font } from '../src/typography';
import { ApiError, type Case, createCase, getCase, getBackend, hostedBuild, lastCase, money, postCase, rememberCase } from '../src/api';
import { Button, Card, Divider, IconButton, Input, Mark, Message, Screen, SectionHeader, Sheet, color, ui } from '../src/ui';

const destinations = [
  { key: 'check', title: 'Check', icon: 'maximize' },
  { key: 'proof', title: 'Proof', icon: 'file-text' },
  { key: 'aid', title: 'Aid', icon: 'heart' },
  { key: 'act', title: 'Act', icon: 'phone' },
] as const;
const navigation = { index: 0, routes: [...destinations] };
const noBarInsets = { bottom: 0, left: 0, right: 0 };

function CaseLink({ title, label, detail, amount, icon, disabled, pending = false, featured = false, onPress }:
  { title: string; label: string; detail?: string; amount?: string; icon: IconName;
    disabled: boolean; pending?: boolean; featured?: boolean; onPress: () => void }) {
  return <TouchableRipple accessibilityRole="button" accessibilityLabel={title === label ? label : `${title}. ${label}`}
    accessibilityHint={[detail, amount].filter(Boolean).join('. ') || undefined}
    accessibilityState={{ disabled, busy: pending }} disabled={disabled} onPress={onPress}>
    <View style={[styles.caseRow, featured && styles.featuredRow]}>
      <View style={[styles.rowIcon, featured && styles.featuredIcon]}>
        <AppIcon name={icon} size={22} color={color.primary} />
      </View>
      <View style={[ui.grow, styles.rowDescription]}>
        <Text style={ui.label}>{title}</Text>
        {!!detail && <Text style={ui.small}>{detail}</Text>}
        {!!amount && <Text style={[ui.money, styles.caseAmount]}>{amount}</Text>}
      </View>
      {pending ? <ActivityIndicator size="small" color={color.primary} /> : <AppIcon name="chevron-right" size={18} color={color.muted} />}
    </View>
  </TouchableRipple>;
}

export default function Home() {
  const [latest, setLatest] = useState<string | null>(null);
  const [recent, setRecent] = useState<Case | null>(null);
  const [busy, setBusy] = useState<CaptureMethod | 'paste' | 'sample' | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [mode, setMode] = useState('scan');
  const [text, setText] = useState('');
  const importing = useRef(false);
  const blank = useRef<{ id: string; revision: number } | null>(null);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(false);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [versioned, setVersioned] = useState(false);
  const [browse, setBrowse] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    void lastCase().then(async (id) => {
      if (!active) return;
      setLatest(id);
      setRecent((saved) => saved?.id === id ? saved : null);
      if (id) {
        const saved = await getCase(id);
        if (active) setRecent(saved);
      }
    }).catch(() => undefined);
    void getBackend().then((backend) => { if (active) setVersioned(backend.prefix === '/v1'); }).catch(() => undefined);
    return () => { active = false; };
  }, [connectionRevision]));

  const open = (id: string, options?: { document?: string; section?: string }) =>
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
      setCaptureOpen(false);
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
            setCaptureOpen(false);
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

  async function go(section: string) {
    if (section === 'check') return;
    try {
      const id = latest ?? await lastCase();
      if (id) open(id, { section });
      else setError('Add a bill to start a case.');
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  const reviewed = recent && recent.investigated_revision === recent.revision;
  const conditionalAmount = reviewed ? recent?.scenario?.conditional : undefined;
  const recentDetail = conditionalAmount != null ? 'Conditional invoice'
    : reviewed ? 'Review complete'
    : recent?.documents.some((document) => !document.confirmed) ? 'Confirm document lines'
    : recent?.documents.length ? 'Ready for review'
    : recent ? 'Add a bill to begin' : 'Pick up where you left off';

  return (
    <Screen>
      <View style={[ui.between, styles.appBar]}>
        <View style={ui.row}><Mark size={34} /><Text style={styles.brand}>FairBill</Text></View>
        <IconButton label="Settings" icon="settings" onPress={() => setSettings(true)} />
      </View>
      <ScrollView style={ui.grow} contentContainerStyle={[ui.content, styles.homeContent]}>
        {error && !captureOpen ? <Message text={error} onClose={() => setError('')} /> : null}
        <View style={styles.intro}>
          <Text accessibilityRole="header" style={[ui.title, styles.headline]}>Check a hospital bill</Text>
          <Text style={ui.body}>Review each charge and see what to ask the billing team.</Text>
          <View style={styles.introAction}>
            {hostedBuild ? <Button label="Open tester settings" icon="key" tone="ghost" onPress={() => setSettings(true)} /> :
              <Button label="Add a bill" icon="plus" disabled={!!busy} onPress={() => {
                setError('');
                setCaptureOpen(true);
              }} />}
          </View>
        </View>
        {!!latest && <View style={ui.stack}>
          <SectionHeader>Recent case</SectionHeader>
          <View style={styles.recentCase}>
            <CaseLink title={recent?.sample ? 'Sample investigation' : 'Continue your case'} label="Resume last case"
              featured icon="receipt" disabled={!!busy} onPress={() => open(latest)}
              detail={recentDetail} amount={conditionalAmount != null ? money(conditionalAmount) : undefined} />
          </View>
        </View>}
        <View style={styles.caseList}>
          {versioned && <><CaseLink title="Your cases" label="Your cases" icon="folder"
            disabled={!!busy} onPress={() => setBrowse(true)} />{!cloudBuild && <Divider />}</>}
          {!cloudBuild && <CaseLink title="Try a sample bill" label="Open sample case" detail="See a review using a fictional bill."
            icon="file-text" pending={busy === 'sample'} disabled={!!busy} onPress={() => void start('sample')} />}
        </View>
        <ConnectionStatus refresh={connectionRevision} problemsOnly />
      </ScrollView>
      {captureOpen && <Sheet title="Add a bill" onClose={() => {
        if (importing.current) return;
        setCaptureOpen(false);
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
            <SegmentedButtons value={mode} onValueChange={setMode} buttons={[
              { value: 'scan', label: 'Scan or upload', disabled: !!busy },
              { value: 'paste', label: 'Paste text', disabled: !!busy },
            ]} />
            {mode === 'scan' ? <CaptureOptions pending={busy === 'camera' || busy === 'photo' || busy === 'file' ? busy : undefined}
              disabled={!!busy} onChoose={(method) => void start(method)} /> : <Card>
              <SectionHeader>Paste an itemised bill</SectionHeader>
              <Input label="Itemised bill text" accessibilityLabel="Itemised bill text" value={text} onChangeText={setText}
                multiline editable={!busy} maxLength={20000} style={styles.paste} />
              <Button label="Check pasted bill" icon="arrow-right" busy={busy === 'paste'} disabled={!!busy || !text.trim()} onPress={() => void start('paste')} />
            </Card>}
          </ScrollView>
        </KeyboardAvoidingView>
      </Sheet>}
      <BottomNavigation.Bar navigationState={navigation} safeAreaInsets={noBarInsets}
        keyboardHidesNavigationBar getAccessibilityLabel={({ route }) => route.title}
        activeIndicatorStyle={styles.navIndicator}
        activeColor={color.onSecondaryContainer} inactiveColor={color.muted}
        renderIcon={({ route, color: tint }) => <AppIcon name={route.icon} size={24} color={tint} />}
        onTabPress={({ route, preventDefault }) => { if (busy) preventDefault(); else void go(route.key); }} />
      {browse && <CaseList onClose={() => setBrowse(false)} onOpen={(id) => {
        setBrowse(false);
        void rememberCase(id).then(() => open(id)).catch((cause: Error) => setError(cause.message));
      }} />}
      {settings && <AccountSettings onClose={() => setSettings(false)} onInvite={() => {
        setConnectionRevision((value) => value + 1);
        setError('');
      }} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  appBar: { paddingHorizontal: 16, paddingVertical: 6 },
  brand: { fontFamily: font.bold, fontSize: 23, letterSpacing: -0.6, color: color.ink },
  homeContent: { gap: 24, paddingTop: 14 },
  intro: { gap: 10, borderRadius: 28, padding: 22, backgroundColor: color.primaryContainer },
  headline: { color: color.onPrimaryContainer, maxWidth: 300, fontSize: 38, lineHeight: 43, letterSpacing: -1.5 },
  introAction: { paddingTop: 8 },
  recentCase: { borderRadius: 20, backgroundColor: color.card, borderWidth: 1, borderColor: color.line, overflow: 'hidden' },
  caseList: { borderRadius: 20, backgroundColor: color.surfaceContainer, overflow: 'hidden' },
  caseRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 62 },
  featuredRow: { paddingVertical: 16 },
  rowIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  featuredIcon: { backgroundColor: color.secondaryContainer },
  rowDescription: { gap: 2 },
  caseAmount: { fontSize: 24, lineHeight: 30 },
  paste: { minHeight: 144 },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  navIndicator: { width: 56, height: 32, borderRadius: 16 },
});
