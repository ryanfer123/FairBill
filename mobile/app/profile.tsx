import { router } from 'expo-router';
import { useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import { useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Chip } from 'react-native-paper';
import { accountUser, updateProfile, type PreferredEvidence } from '../src/cloud-auth';
import { AppIcon } from '../src/icons';
import { themedStyles, useFairBillTheme } from '../src/theme';
import { font } from '../src/typography';
import { Button, Card, IconButton, Input, Message, Screen, SectionHeader } from '../src/ui';

const preferences: { value: PreferredEvidence; label: string }[] = [
  { value: 'service_record', label: 'Service record' },
  { value: 'settlement', label: 'Settlement' },
  { value: 'policy', label: 'Insurance policy' },
];

function readProfile() {
  const metadata = accountUser()?.user_metadata;
  const evidence = metadata?.preferred_evidence;
  return {
    name: typeof metadata?.display_name === 'string' ? metadata.display_name : '',
    state: typeof metadata?.home_state === 'string' ? metadata.home_state : '',
    evidence: evidence === 'settlement' || evidence === 'policy' ? evidence : 'service_record' as PreferredEvidence,
  };
}

export default function Profile() {
  const { color, ui } = useFairBillTheme();
  const styles = useStyles();
  const navigation = useNavigation();
  const user = accountUser();
  const [stored, setStored] = useState(readProfile);
  const [draft, setDraft] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const working = useRef(false);
  const dirty = draft.name.trim() !== stored.name || draft.state.trim() !== stored.state || draft.evidence !== stored.evidence;

  usePreventRemove(dirty || saving, ({ data }) => {
    if (working.current) return;
    Alert.alert('Discard profile changes?', 'These changes will disappear when you leave.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard changes', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  function edit(patch: Partial<typeof draft>) {
    setDraft(current => ({ ...current, ...patch }));
    setSaved(false);
    setError('');
  }

  async function save() {
    if (working.current || !dirty) return;
    working.current = true;
    setSaving(true);
    setError('');
    try {
      await updateProfile(draft);
      const next = readProfile();
      setStored(next);
      setDraft(next);
      setSaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      working.current = false;
      setSaving(false);
    }
  }

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return <Screen>
    <View style={styles.header}>
      <IconButton label="Back from Profile" icon="arrow-left" onPress={back} />
      <Text accessibilityRole="header" style={[ui.title, ui.grow]}>Profile</Text>
    </View>
    <KeyboardAvoidingView style={ui.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
        {user ? <>
          <Card tone="tonal">
            <View style={styles.identity}>
              <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.avatar}>
                {stored.name.trim() ? <Text style={styles.initial}>{Array.from(stored.name.trim())[0]?.toLocaleUpperCase()}</Text>
                  : <AppIcon name="user" color={color.onPrimaryContainer} size={30} />}
              </View>
              <View style={ui.grow}>
                <Text style={ui.heading}>{stored.name.trim() || 'Your FairBill account'}</Text>
                <Text style={ui.small}>Sign-in email</Text>
                <Text selectable style={ui.body}>{user.email || 'Email unavailable'}</Text>
              </View>
            </View>
          </Card>
          <Card>
            <SectionHeader>Personal details</SectionHeader>
            <Input label="Display name" accessibilityLabel="Display name" value={draft.name}
              onChangeText={name => edit({ name })} maxLength={80} autoCapitalize="words" editable={!saving} />
          </Card>
          <Card>
            <SectionHeader>Bill review preferences</SectionHeader>
            <Input label="State or union territory" accessibilityLabel="State or union territory" value={draft.state}
              onChangeText={state => edit({ state })} maxLength={60} autoCapitalize="words" editable={!saving} />
            <Text style={ui.small}>Optional. FairBill uses it to surface relevant assistance resources.</Text>
            <Text style={ui.label}>Preferred supporting document</Text>
            <View style={styles.choices}>
              {preferences.map(({ value, label }) => <Chip key={value} selected={draft.evidence === value}
                accessibilityLabel={label} accessibilityRole="radio" accessibilityState={{ checked: draft.evidence === value }}
                disabled={saving} style={styles.choice} onPress={() => edit({ evidence: value })}>{label}</Chip>)}
            </View>
          </Card>
          {error ? <Message text={error} /> : null}
          {saved && <Text accessibilityLiveRegion="polite" style={ui.body}>Profile saved.</Text>}
          <Button label="Save profile" icon="check" busy={saving} disabled={!dirty} onPress={() => void save()} />
        </> : <Card>
          <Text style={ui.body}>Sign in to edit your profile and review preferences.</Text>
          <Button label="Go to sign-in" onPress={() => router.replace('/signin')} />
        </Card>}
      </ScrollView>
    </KeyboardAvoidingView>
  </Screen>;
}

const useStyles = themedStyles(({ color }) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: color.primaryContainer },
  initial: { color: color.onPrimaryContainer, fontFamily: font.semibold, fontSize: 28 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 48, justifyContent: 'center' },
}));
