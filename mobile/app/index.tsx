import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ConnectionStatus } from '../src/connection';
import { configureEndpoint, createCase, endpoint, lastCase, rememberCase } from '../src/api';
import { Badge, Button, Card, Divider, IconButton, Mark, Message, Screen, SectionHeader, Sheet, color, ui } from '../src/ui';

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

  const open = (id: string) => router.push({ pathname: '/case/[id]', params: { id } });

  async function start(sample: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = await createCase(sample);
      await rememberCase(result.id);
      open(result.id);
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
        <Card>
          <Text style={ui.kicker}>HOSPITAL BILL REVIEW</Text>
          <Text accessibilityRole="header" style={ui.title}>Understand what you were billed.</Text>
          <Text style={ui.body}>Review charges, insurance deductions, and the records behind them.</Text>
          <Divider />
          <Text style={ui.label}>Sample investigation</Text>
          <Text style={ui.small}>See how a second lab order changes the bill review.</Text>
          <Button label="Open sample case" icon="arrow-up-right"
            onPress={() => void start(true)} busy={busy} />
        </Card>
        {latest && <Button label="Resume last case" icon="arrow-right" tone="ghost" onPress={() => open(latest)} disabled={busy} />}
        <Card>
          <View style={ui.between}>
            <SectionHeader>Start with a document</SectionHeader>
            <Feather name="maximize" size={22} color={color.forest} />
          </View>
          <Text style={ui.body}>Scan an invoice, import a PDF, or paste the text.</Text>
          <Button label="Create a case" icon="plus" tone="ghost" onPress={() => void start(false)} disabled={busy} />
        </Card>
        <View style={styles.footer}>
          <Badge tone="neutral">Synthetic demo</Badge>
          <Text style={ui.small}>Team Honey Potato · AgenticX</Text>
        </View>
      </ScrollView>
      {settings && <Sheet title="Demo connection" onClose={() => { if (!checking) setSettings(false); }}>
        <KeyboardAvoidingView style={ui.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
            <Text style={ui.body}>Use the default address with USB forwarding, or enter the laptop’s private network address.</Text>
            <TextInput accessibilityLabel="Demo server address" style={ui.input} value={address}
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
  footer: { gap: 6, alignItems: 'flex-start' },
});
