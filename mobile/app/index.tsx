import { AppIcon, type IconName } from '../src/icons';
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
  { key: 'check', title: 'New check', icon: 'plus' },
  { key: 'settings', title: 'Settings', icon: 'settings' },
] as const;
const navigation = { index: 1, routes: [...destinations] };
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
  const [capture, setCapture] = useState<'upload' | 'paste' | null>(null);
  const [text, setText] = useState('');
  const importing = useRef(false);
  const blank = useRef<{ id: string; revision: number } | null>(null);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(false);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [versioned, setVersioned] = useState(cloudBuild);
  const [browse, setBrowse] = useState(false);

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
  const conditionalAmount = reviewed ? recent?.scenario?.conditional : undefined;
  const recentDetail = conditionalAmount != null ? 'Conditional total'
    : reviewed ? 'Review complete'
    : recent?.documents.some((document) => !document.confirmed) ? 'Confirm document lines'
    : recent?.documents.length ? 'Ready for review'
    : recent ? 'Add a bill to begin' : 'Pick up where you left off';

  return (
    <Screen>
      <View style={[ui.between, styles.appBar]}>
        <View style={ui.row}><Mark size={34} /><Text style={styles.brand}>FairBill</Text></View>
      </View>
      <ScrollView style={ui.grow} contentContainerStyle={[ui.content, styles.homeContent]}>
        {error && !capture ? <Message text={error} onClose={() => setError('')} /> : null}
        <View style={styles.intro}>
          <Text accessibilityRole="header" style={[ui.heading, styles.headline]}>Check a hospital bill</Text>
          <Text style={ui.body}>Don’t pay what you don’t owe.</Text>
          {!cloudBuild && <>
            <Button label="Try the sample case" icon="arrow-right" busy={busy === 'sample'} disabled={!!busy} onPress={() => void start('sample')} />
            <Text style={ui.small}>Use fictional documents in this build.</Text>
          </>}
        </View>
        {hostedBuild ? <Button label="Open tester settings" icon="key" tone="ghost" onPress={() => setSettings(true)} />
          : <View style={styles.caseList}>
            <CaseLink title="Scan a bill" label="Scan a bill" icon="camera" disabled={!!busy}
              pending={busy === 'camera'} onPress={() => void start('camera')} />
            <Divider />
            <CaseLink title="Upload a file" label="Upload a file" detail="PDF or photo" icon="upload" disabled={!!busy}
              onPress={() => chooseCapture('upload')} />
            <Divider />
            <CaseLink title="Paste text" label="Paste text" icon="file-text" disabled={!!busy}
              onPress={() => chooseCapture('paste')} />
          </View>}
        {!!latest && <View style={ui.stack}>
          <SectionHeader>Recent case</SectionHeader>
          <View style={styles.recentCase}>
            <CaseLink title={recent?.sample ? 'Sample investigation' : 'Continue your case'} label="Resume last case"
              featured icon="receipt" disabled={!!busy} onPress={() => open(latest)}
              detail={recentDetail} amount={conditionalAmount != null ? money(conditionalAmount) : undefined} />
          </View>
        </View>}
        <ConnectionStatus refresh={connectionRevision} problemsOnly />
      </ScrollView>
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
      <BottomNavigation.Bar navigationState={{ ...navigation, index: browse ? 0 : settings ? 2 : 1 }} safeAreaInsets={noBarInsets}
        keyboardHidesNavigationBar getAccessibilityLabel={({ route }) => route.title}
        activeIndicatorStyle={styles.navIndicator}
        activeColor={color.onSecondaryContainer} inactiveColor={color.muted}
        renderIcon={({ route, color: tint }) => <AppIcon name={route.icon} size={24} color={tint} />}
        onTabPress={({ route, preventDefault }) => {
          if (busy) { preventDefault(); return; }
          if (route.key === 'cases') {
            if (versioned) setBrowse(true);
            else if (latest) open(latest);
            else setError(cloudBuild ? 'Add a bill to start a case.' : 'Open the sample or add a bill to start a case.');
          }
          if (route.key === 'settings') setSettings(true);
        }} />
      {browse && versioned && <CaseList onClose={() => setBrowse(false)} onOpen={(id) => {
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
  homeContent: { gap: 20, paddingTop: 16 },
  intro: { gap: 9 },
  headline: { fontSize: 26, lineHeight: 32 },
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
