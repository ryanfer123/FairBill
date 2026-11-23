import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { configureEndpoint, createCase, endpoint, lastCase, rememberCase } from '../src/api';
import { Badge, Button, IconButton, Mark, Message, Sheet, color, ui } from '../src/ui';

export default function Home() {
  const [latest, setLatest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(false);
  const [address, setAddress] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [checking, setChecking] = useState(false);

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
    setAddress(await endpoint());
    setSettingsError('');
    setSettings(true);
  }

  async function connect() {
    setChecking(true);
    setSettingsError('');
    try {
      await configureEndpoint(address);
      setSettings(false);
      setError('');
    } catch (cause) {
      setSettingsError((cause as Error).message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <SafeAreaView style={ui.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
        <View style={ui.between}>
          <View style={ui.row}>
            <Mark />
            <Text style={styles.brand}>FairBill</Text>
          </View>
          <IconButton label="Connection settings" icon="settings" onPress={() => void openSettings()} />
        </View>
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>HOSPITAL BILL REVIEW</Text>
          <Text style={styles.heroTitle}>Understand what you were billed.</Text>
          <Text style={styles.heroBody}>Check hospital charges against records and insurance paperwork. See the evidence behind every question.</Text>
          <View style={styles.heroRule} />
          <View style={[ui.between, { alignItems: 'flex-end' }]}>
            <View style={ui.grow}>
              <Text style={styles.previewLabel}>Sample hospital invoice</Text>
              <Text style={styles.samplePrice}>₹1,56,800</Text>
            </View>
            <View style={styles.pill}>
              <Feather name="layers" size={16} color={color.lime} />
              <Text style={styles.pillText}>4 documents</Text>
            </View>
          </View>
          <Button label="Open sample case" icon="arrow-up-right" tone="light"
            onPress={() => void start(true)} busy={busy} />
        </View>
        {error && <Message text={error} onClose={() => setError('')} />}
        {latest && <Button label="Resume last case" icon="arrow-right" tone="ghost" onPress={() => open(latest)} disabled={busy} />}
        <View style={ui.card}>
          <View style={ui.between}>
            <Text style={ui.heading}>Start with a document</Text>
            <Feather name="maximize" size={22} color={color.forest} />
          </View>
          <Text style={ui.body}>Scan an invoice, import a PDF, or paste the text.</Text>
          <Button label="Create a case" icon="plus" tone="ghost" onPress={() => void start(false)} disabled={busy} />
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
            <TextInput accessibilityLabel="Demo server address" style={ui.input} value={address}
              onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            {settingsError && <Message text={settingsError} />}
            <Button label="Test and save connection" icon="check" onPress={() => void connect()} busy={checking} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Sheet>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brand: { fontSize: 25, fontWeight: '800', letterSpacing: -0.8, color: color.ink },
  hero: { gap: 16, padding: 22, borderRadius: 26, backgroundColor: color.forest },
  heroLabel: { color: color.mint, fontSize: 11, letterSpacing: 1.65, fontWeight: '800' },
  heroTitle: { color: '#F7F9EF', fontSize: 42, letterSpacing: -2, lineHeight: 45, fontWeight: '800' },
  heroBody: { color: '#D1E2D3', fontSize: 15, lineHeight: 23, maxWidth: 430 },
  heroRule: { height: 1, backgroundColor: '#426153' },
  previewLabel: { color: '#C2D9CA', fontSize: 13 },
  samplePrice: { color: color.lime, fontSize: 30, letterSpacing: -0.8, fontWeight: '800' },
  pill: { flexDirection: 'row', gap: 6, alignItems: 'center', borderWidth: 1, borderColor: '#557468',
    borderRadius: 20, paddingVertical: 7, paddingHorizontal: 9 },
  pillText: { color: '#E2F1E4', fontSize: 11, fontWeight: '700' },
  footer: { gap: 6, alignItems: 'flex-start' },
});
