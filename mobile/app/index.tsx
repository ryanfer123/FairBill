import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CaseList } from '../src/cases';
import { ConnectionStatus } from '../src/connection';
import { configureEndpoint, configureInvite, createCase, endpoint, getBackend, hostedBuild, lastCase, rememberCase } from '../src/api';
import { Badge, Button, Card, Divider, IconButton, Input, Mark, Message, Screen, SectionHeader, Sheet, color, ui } from '../src/ui';

export default function Home() {
  const [latest, setLatest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  const open = (id: string, capture = false) => router.push({ pathname: '/case/[id]', params: { id, capture: capture ? '1' : '0' } });

  async function start(sample: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = await createCase(sample);
      await rememberCase(result.id);
      open(result.id, !sample);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
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
      <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
        <View style={ui.between}>
          <View style={ui.row}>
            <Mark />
            <Text style={styles.brand}>FairBill</Text>
          </View>
          <IconButton label={hostedBuild ? "Test access" : "Connection settings"} icon="settings" onPress={() => void openSettings()} />
        </View>
        <ConnectionStatus refresh={connectionRevision} />
        {error ? <Message text={error} onClose={() => setError('')} /> : null}
        {hostedBuild && <Button label="Enter tester invite" icon="key" tone="ghost" onPress={() => void openSettings()} />}
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Feather name="file-text" size={26} color={color.deeper} /></View>
          <Text accessibilityRole="header" style={styles.heroTitle}>Don’t pay what you don’t owe.</Text>
          <Text style={styles.heroBody}>Trace hospital charges and insurance deductions to the records behind them.</Text>
        </View>
        {latest && <Card tone="tonal">
          <Text style={ui.label}>Continue your investigation</Text>
          <Button label="Resume last case" icon="arrow-right" tone="light" onPress={() => open(latest)} disabled={busy} />
        </Card>}
        {versioned && <Button label="Your cases" icon="folder" tone="ghost" onPress={() => setBrowse(true)} />}
        <View style={ui.stack}>
          <SectionHeader>Review a bill</SectionHeader>
          <Card>
            {!hostedBuild && <>
            <View style={ui.row}>
              <Feather name="camera" size={22} color={color.forest} />
              <View style={ui.grow}>
                <Text style={ui.label}>Start with a document</Text>
                <Text style={ui.small}>Take a photo, choose a PDF, or paste text.</Text>
              </View>
            </View>
            <Button label="Create a case" icon="plus" onPress={() => void start(false)} disabled={busy} />
            <Divider />
            </>}
            <View style={ui.row}>
              <Feather name="layers" size={22} color={color.forest} />
              <View style={ui.grow}>
                <Text style={ui.label}>Try a sample investigation</Text>
                <Text style={ui.small}>See what changes when a second lab order is added.</Text>
              </View>
            </View>
            <Button label="Open sample case" icon="arrow-up-right" tone="ghost" onPress={() => void start(true)} busy={busy} />
          </Card>
        </View>
        <View style={styles.footer}>
          <Badge tone="neutral">Synthetic demo</Badge>
          <Text style={ui.small}>Team Honey Potato · AgenticX</Text>
        </View>
      </ScrollView>
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
  brand: { fontSize: 25, fontWeight: '800', letterSpacing: -0.8, color: color.ink },
  hero: { padding: 24, backgroundColor: color.deeper, borderRadius: 28, gap: 14 },
  heroIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: color.mint,
    alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: color.lime, fontSize: 35, fontWeight: '600', letterSpacing: -0.9 },
  heroBody: { color: color.mint, fontSize: 16, lineHeight: 24 },
  footer: { gap: 6, alignItems: 'flex-start' },
});
