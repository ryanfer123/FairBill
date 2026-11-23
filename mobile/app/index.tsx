import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConnectionStatus } from '../src/connection';
import { configureEndpoint, createCase, endpoint, lastCase, rememberCase } from '../src/api';
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

  useFocusEffect(useCallback(() => {
    let active = true;
    void lastCase().then((id) => { if (active) setLatest(id); }).catch(() => undefined);
    return () => { active = false; };
  }, []));

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
      setAddress(await endpoint());
      setSettingsError('');
      setSettings(true);
    } catch (cause) { setError((cause as Error).message); }
  }

  async function connect() {
    setChecking(true);
    setSettingsError('');
    try {
      await configureEndpoint(address);
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
          <IconButton label="Connection settings" icon="settings" onPress={() => void openSettings()} />
        </View>
        <ConnectionStatus refresh={connectionRevision} />
        {error ? <Message text={error} onClose={() => setError('')} /> : null}
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Feather name="file-text" size={26} color={color.deeper} /></View>
          <Text accessibilityRole="header" style={styles.heroTitle}>Don’t pay what you don’t owe.</Text>
          <Text style={styles.heroBody}>Trace hospital charges and insurance deductions to the records behind them.</Text>
        </View>
        {latest && <Card tone="tonal">
          <Text style={ui.label}>Continue your investigation</Text>
          <Button label="Resume last case" icon="arrow-right" tone="light" onPress={() => open(latest)} disabled={busy} />
        </Card>}
        <View style={ui.stack}>
          <SectionHeader>Review a bill</SectionHeader>
          <Card>
            <View style={ui.row}>
              <Feather name="camera" size={22} color={color.forest} />
              <View style={ui.grow}>
                <Text style={ui.label}>Start with a document</Text>
                <Text style={ui.small}>Take a photo, choose a PDF, or paste text.</Text>
              </View>
            </View>
            <Button label="Create a case" icon="plus" onPress={() => void start(false)} disabled={busy} />
            <Divider />
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
      {settings && <Sheet title="Demo connection" onClose={() => { if (!checking) setSettings(false); }}>
        <KeyboardAvoidingView style={ui.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
            <Text style={ui.body}>Use the default address with USB forwarding, or enter the laptop’s private network address.</Text>
            <Input accessibilityLabel="Demo server address" label="Laptop API address" value={address}
              onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            {settingsError && <Message text={settingsError} />}
            <Button label="Test and save connection" icon="check" onPress={() => void connect()} busy={checking} />
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
