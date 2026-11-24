import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CaseList } from '../src/cases';
import { SegmentedButtons } from 'react-native-paper';
import { documentForm, pickDocument, type CaptureMethod } from '../src/document-picker';
import { ConnectionStatus } from '../src/connection';
import { ApiError, configureEndpoint, configureInvite, createCase, endpoint, getCase, getBackend, hostedBuild, lastCase, postCase, rememberCase } from '../src/api';
import { Badge, Button, Card, IconButton, Input, Mark, Message, Screen, SectionHeader, Sheet, color, ui } from '../src/ui';

export default function Home() {
  const [latest, setLatest] = useState<string | null>(null);
  const [busy, setBusy] = useState<CaptureMethod | 'paste' | 'sample' | null>(null);
  const [mode, setMode] = useState('scan');
  const [text, setText] = useState('');
  const importing = useRef(false);
  const blank = useRef<{ id: string; revision: number } | null>(null);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(false);
  const [address, setAddress] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [checking, setChecking] = useState(false);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [versioned, setVersioned] = useState(false);
  const [browse, setBrowse] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    void lastCase().then((id) => { if (active) setLatest(id); }).catch(() => undefined);
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

  function go(section: string) {
    if (section === 'check') return;
    if (latest) open(latest, { section });
    else setError('Open the sample or add a bill to start a case.');
  }

  async function openSettings() {
    try {
      setAddress(hostedBuild ? '' : await endpoint());
      setSettingsError('');
      setSettings(true);
    } catch (cause) { setError((cause as Error).message); }
  }

  async function connect() {
    setChecking(true);
    setSettingsError('');
    try {
      if (hostedBuild) await configureInvite(address);
      else await configureEndpoint(address);
      blank.current = null;
      setSettings(false);
      setConnectionRevision((value) => value + 1);
      setError('');
    } catch (cause) {
      setSettingsError((cause as Error).message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <Screen>
      <View style={[ui.between, styles.appBar]}>
        <View style={ui.row}><Mark size={34} /><Text style={styles.brand}>FairBill</Text></View>
        <IconButton label={hostedBuild ? 'Test access' : 'Connection settings'} icon="settings" onPress={() => void openSettings()} />
      </View>
      <KeyboardAvoidingView style={ui.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Text accessibilityRole="header" style={styles.heroTitle}>Don’t pay what you don’t owe.</Text>
            <Text style={ui.body}>Check your hospital bill and see which records support each question.</Text>
          </View>
          {error ? <Message text={error} onClose={() => setError('')} /> : null}
          {hostedBuild ? <Button label="Enter tester invite" icon="key" tone="ghost" onPress={() => void openSettings()} /> : <>
            <View style={styles.note}>
              <Feather name="lock" size={16} color={color.forest} />
              <Text style={[ui.small, ui.grow]}>Use fictional documents in this build.</Text>
            </View>
            <SegmentedButtons value={mode} onValueChange={setMode} buttons={[
              { value: 'scan', label: 'Scan or upload', disabled: !!busy },
              { value: 'paste', label: 'Paste text', disabled: !!busy },
            ]} />
            {mode === 'scan' ? <Card>
              <View style={styles.captureGuide}>
                <View style={styles.captureIcon}><Feather name="maximize" size={25} color={color.forest} /></View>
                <SectionHeader>Take a photo or upload a PDF</SectionHeader>
                <Text style={styles.captureCopy}>Use an itemised statement and include the full page.</Text>
              </View>
              <Button label="Scan bill photo" icon="camera" busy={busy === 'camera'} disabled={!!busy} onPress={() => void start('camera')} />
              <Button label="Choose file from device" icon="upload" tone="ghost" busy={busy === 'file'} disabled={!!busy} onPress={() => void start('file')} />
              <Button label="Choose existing photo" icon="image" tone="light" busy={busy === 'photo'} disabled={!!busy} onPress={() => void start('photo')} />
            </Card> : <Card>
              <SectionHeader>Paste an itemised bill</SectionHeader>
              <Input label="Itemised bill text" accessibilityLabel="Itemised bill text" value={text} onChangeText={setText}
                multiline editable={!busy} maxLength={20000} style={styles.paste} />
              <Button label="Check pasted bill" icon="arrow-right" busy={busy === 'paste'} disabled={!!busy || !text.trim()} onPress={() => void start('paste')} />
            </Card>}
          </>}
          <Card tone="tonal">
            <Badge tone="neutral">Synthetic example</Badge>
            <SectionHeader>Try a sample bill</SectionHeader>
            <Text style={ui.body}>Follow the evidence from the original invoice to the revised total after a second lab order.</Text>
            <Button label="Open sample case" icon="arrow-up-right" tone="ghost" busy={busy === 'sample'} disabled={!!busy} onPress={() => void start('sample')} />
          </Card>
          {latest && <Button label="Resume last case" icon="arrow-right" tone="ghost" onPress={() => open(latest)} disabled={!!busy} />}
          {versioned && <Button label="Your cases" icon="folder" tone="ghost" onPress={() => setBrowse(true)} disabled={!!busy} />}
          <View style={styles.note}>
            <Feather name="lock" size={16} color={color.forest} />
            <Text style={[ui.small, ui.grow]}>Review the redacted packet before sharing.</Text>
          </View>
          <ConnectionStatus refresh={connectionRevision} />
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={styles.nav}>
        {([
          { id: 'check', label: 'Check', icon: 'maximize' },
          { id: 'proof', label: 'Proof', icon: 'file-text' },
          { id: 'aid', label: 'Aid', icon: 'heart' },
          { id: 'act', label: 'Act', icon: 'phone' },
        ] as const).map(({ id, label, icon }) => <Pressable key={id} accessibilityRole="tab"
          accessibilityLabel={label} accessibilityState={{ selected: id === 'check', disabled: !!busy }}
          onPress={() => go(id)} disabled={!!busy} style={styles.navItem}>
          <View style={[styles.navIcon, id === 'check' && styles.navActive]}><Feather name={icon} size={20} color={color.forest} /></View>
          <Text style={ui.kicker}>{label}</Text>
        </Pressable>)}
      </View>
      {browse && <CaseList onClose={() => setBrowse(false)} onOpen={(id) => {
        setBrowse(false);
        void rememberCase(id).then(() => open(id)).catch((cause: Error) => setError(cause.message));
      }} />}
      {settings && <Sheet title={hostedBuild ? "Tester access" : "Demo connection"} onClose={() => { if (!checking) setSettings(false); }}>
        <KeyboardAvoidingView style={ui.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
            <Text style={ui.body}>{hostedBuild
              ? 'Enter the invite code for this closed test to open the synthetic case.'
              : 'Use the default address with USB forwarding, or enter the laptop’s private network address.'}</Text>
            <Input accessibilityLabel={hostedBuild ? 'Tester invite code' : 'Demo server address'}
              label={hostedBuild ? 'Tester invite code' : 'Laptop API address'} value={address}
              onChangeText={setAddress} autoCapitalize="none" autoCorrect={false}
              secureTextEntry={hostedBuild} keyboardType={hostedBuild ? 'default' : 'url'} />
            {settingsError && <Message text={settingsError} />}
            <Button label={hostedBuild ? 'Verify invite' : 'Test and save connection'} icon="check"
              onPress={() => void connect()} busy={checking} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Sheet>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  appBar: { paddingHorizontal: 16, paddingVertical: 6 },
  brand: { fontSize: 23, fontWeight: '700', letterSpacing: -0.6, color: color.ink },
  hero: { gap: 8, paddingVertical: 3 },
  heroTitle: { color: color.ink, fontSize: 32, fontWeight: '600', letterSpacing: -0.7 },
  captureGuide: { padding: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: color.line,
    borderRadius: 16, alignItems: 'center', gap: 8, backgroundColor: color.paper },
  captureIcon: { borderRadius: 12, padding: 9, backgroundColor: color.panel },
  captureCopy: { color: color.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  paste: { minHeight: 144 },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  nav: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line,
    backgroundColor: color.card, justifyContent: 'space-around', paddingVertical: 4 },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 54, gap: 2 },
  navIcon: { paddingHorizontal: 16, paddingVertical: 4, borderRadius: 20 },
  navActive: { backgroundColor: color.mint },
});
