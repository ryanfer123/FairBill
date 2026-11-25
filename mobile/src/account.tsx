import * as SecureStore from 'expo-secure-store';
import Animated from 'react-native-reanimated';
import { Illustration } from './illustrations';
import { AppIcon, type IconName } from './icons';
import { font } from './typography';
import { surfaceReveal } from './motion';
import Constants from 'expo-constants';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewProps } from 'react-native';
import { ConnectionStatus } from './connection';
import { configureInvite, forgetCase, hostedBuild, request } from './api';
import { accountUser, cloudBuild, confirmSignInLink, requestSignInCode, restoreAccount, signOutAccount, verifySignInCode } from './cloud-auth';
import { Button, Card, Divider, IconButton, Input, Mark, Message, Screen, SectionHeader, Sheet, color, ui } from './ui';

const welcomeSteps = [
  { title: 'Welcome to FairBill', body: 'Check hospital bills against your records.', art: 'welcome' },
  { title: 'Follow the evidence', body: 'Open a billing question to see the document and exact line behind it.', art: 'evidence' },
  { title: 'You stay in control', body: 'Review the exact letter or call script before deciding what to share.', art: 'letter' },
] as const;
const welcomeKey = 'fairbill_welcome_seen';
const privacyUrl: string | undefined = Constants.expoConfig?.extra?.fairbillPrivacyUrl;

export function SignIn({ restoring }: { restoring: boolean }) {
  const [email, setEmail] = useState('');
  const [destination, setDestination] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(restoring);
  const [settings, setSettings] = useState(false);
  const pending = useRef(false);
  const [welcome, setWelcome] = useState<number | null>(null);
  const [welcomeReady, setWelcomeReady] = useState(false);

  async function run(action: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (cause) { setError((cause as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }

  useEffect(() => {
    const callback = ({ url }: { url: string }) => {
      if (/^fairbill:\/\/signin(?:[?#]|$)/.test(url)) void run(() => confirmSignInLink(url));
    };
    const listener = Linking.addEventListener('url', callback);
    if (restoring) void run(async () => {
      const url = await Linking.getInitialURL();
      if (url && /^fairbill:\/\/signin(?:[?#]|$)/.test(url)) {
        try { await confirmSignInLink(url); return; }
        catch (cause) { await restoreAccount(); throw cause; }
      }
      await restoreAccount();
    });
    return () => listener.remove();
  }, [restoring]);

  useEffect(() => {
    if (restoring) return;
    let active = true;
    void SecureStore.getItemAsync(welcomeKey).then((seen) => {
      if (active && !seen) setWelcome(0);
    }).catch(() => undefined).finally(() => {
      if (active) setWelcomeReady(true);
    });
    return () => { active = false; };
  }, [restoring]);

  function finishWelcome() {
    setWelcome(null);
    void SecureStore.setItemAsync(welcomeKey, 'yes').catch(() => undefined);
  }

  async function send() {
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Enter a valid email address.');
    await requestSignInCode(value);
    setCode('');
    setDestination(value);
  }

  if (!restoring && !welcomeReady) return <Screen><View style={ui.content}><Mark size={42} /></View></Screen>;

  if (!restoring && welcome !== null) {
    const step = welcomeSteps[welcome]!;
    const last = welcome === welcomeSteps.length - 1;
    return <Screen><ScrollView contentContainerStyle={[ui.content, { flexGrow: 1 }]} keyboardShouldPersistTaps="handled">
      <View style={ui.between}>
        <View style={ui.row}><Mark /><Text style={ui.label}>FairBill</Text></View>
        <Button label="Skip" tone="ghost" onPress={finishWelcome} />
      </View>
      <Animated.View key={welcome} entering={surfaceReveal} style={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }}>
        <Illustration name={step.art} size={164} />
        <Text accessibilityRole="header" style={[ui.title, { textAlign: 'center' }]}>{step.title}</Text>
        <Text style={[ui.body, { textAlign: 'center' }]}>{step.body}</Text>
      </Animated.View>
      <Text accessibilityLiveRegion="polite" style={[ui.small, { textAlign: 'center' }]}>Step {welcome + 1} of {welcomeSteps.length}</Text>
      <Button label={last ? 'Get started' : 'Continue'} icon="arrow-right" onPress={() => {
        if (last) finishWelcome(); else setWelcome(welcome + 1);
      }} />
      {welcome > 0 && <Button label="Back" tone="ghost" onPress={() => setWelcome(welcome - 1)} />}
    </ScrollView></Screen>;
  }

  return <Screen>
    <KeyboardAvoidingView style={ui.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
        <View style={ui.between}><Mark size={48} /><IconButton label="Settings" icon="settings" onPress={() => setSettings(true)} /></View>
        <View style={ui.between}>
          <View style={[ui.grow, ui.stack]}>
            <Text accessibilityRole="header" style={ui.title}>Sign in</Text>
            <Text style={ui.body}>Continue your bill reviews with an email code or sign-in link.</Text>
          </View>
          <Illustration name="signin" size={62} />
        </View>
        {error ? <Message text={error} onClose={() => setError('')} /> : null}
        {restoring ? <Button label="Restore session" icon="refresh-cw" busy={busy} onPress={() => void run(restoreAccount)} /> : <Card>
          <SectionHeader>{destination ? 'Check your email' : 'Sign in with email'}</SectionHeader>
          {destination ? <>
            <Text style={ui.body}>Open the sign-in link on this phone, or enter the code if your email includes one. We sent it to {destination}.</Text>
            <Input label="Email code" accessibilityLabel="Email code" value={code}
              onChangeText={(value) => setCode(value.replace(/\D/g, ''))} keyboardType="number-pad"
              autoComplete="one-time-code" maxLength={10} editable={!busy} />
            <Button label="Verify code" icon="arrow-right" busy={busy} disabled={code.length < 6}
              onPress={() => void run(() => verifySignInCode(destination, code))} />
            <Button label="Send a new email" tone="ghost" disabled={busy} onPress={() => void run(send)} />
            <Button label="Use a different email" tone="ghost" disabled={busy} onPress={() => { setDestination(''); setError(''); }} />
          </> : <>
            <Input label="Email address" accessibilityLabel="Email address" value={email} onChangeText={setEmail}
              autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" editable={!busy} />
            <Button label="Send sign-in email" icon="mail" busy={busy} onPress={() => void run(send)} />
          </>}
        </Card>}
        {privacyUrl && <Button label="Privacy notice" tone="ghost" onPress={() => void run(() => Linking.openURL(privacyUrl))} />}
      </ScrollView>
    </KeyboardAvoidingView>
    {settings && <AccountSettings onClose={() => setSettings(false)} />}
  </Screen>;
}

const panelTitles = { main: 'Settings', help: 'Help with a bill', about: 'About FairBill', status: 'Service status', delete: 'Delete your account', invite: 'Tester access' };

function SettingRow({ label, icon, onPress, disabled, danger = false, external = false }:
  { label: string; icon: IconName; onPress: () => void; disabled: boolean; danger?: boolean; external?: boolean }) {
  const tint = danger ? color.onErrorContainer : color.primary;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [settings.row, pressed && settings.pressed]}>
    <AppIcon name={icon} size={21} color={tint} />
    <Text style={[ui.label, ui.grow, danger && { color: tint }]}>{label}</Text>
    <AppIcon name={external ? 'external-link' : 'chevron-right'} size={16} color={tint} />
  </Pressable>;
}

export function AccountSettings({ onClose, onInvite, embedded = false, onScroll, clearance }: { onScroll?: ScrollViewProps['onScroll']; clearance?: number; onClose: () => void; onInvite?: () => void; embedded?: boolean }) {
  const [panel, setPanel] = useState<keyof typeof panelTitles>('main');
  const [confirmation, setConfirmation] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const user = accountUser();

  async function run(action: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try { await action(); } catch (cause) {
      setError((cause as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function endSession(deleteAccount: boolean) {
    if (deleteAccount) {
      await forgetCase();
      await request<void>('/account', { method: 'DELETE' });
    }
    await signOutAccount(deleteAccount);
  }

  function show(next: keyof typeof panelTitles) {
    setError('');
    setConfirmation('');
    setPanel(next);
  }

  const content = <KeyboardAvoidingView style={ui.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView key={panel} onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={[ui.content, clearance != null && { paddingBottom: clearance }]} keyboardShouldPersistTaps="handled">
      {error ? <Message text={error} /> : null}
      {panel === 'delete' && <Card>
        <Text style={ui.body}>This permanently deletes your account, saved cases and uploaded bills.</Text>
        <Input label="Type DELETE to confirm" accessibilityLabel="Type DELETE to confirm" value={confirmation}
          onChangeText={setConfirmation} autoCapitalize="characters" autoCorrect={false} editable={!busy} />
        <Button label="Permanently delete account" icon="trash-2" busy={busy} disabled={confirmation !== 'DELETE'}
          onPress={() => void run(() => endSession(true))} />
      </Card>}
      {panel === 'main' && <>
        {embedded && <Text accessibilityRole="header" style={settings.title}>Settings</Text>}
        {user && <View style={settings.profile}>
          <View style={settings.identity}><AppIcon name="user" size={24} color={color.paper} /></View>
          <View style={ui.grow}>
            <Text style={settings.caption}>Signed in to FairBill</Text>
            <Text selectable style={settings.email}>{user.email || 'Your account'}</Text>
          </View>
        </View>}
        <View style={ui.stack}>
          <SectionHeader>Help &amp; information</SectionHeader>
          <View style={settings.group}>
            <SettingRow label="Help with a bill" icon="message-circle" disabled={busy} onPress={() => show('help')} /><Divider />
            <SettingRow label="Service status" icon="alert-circle" disabled={busy} onPress={() => show('status')} /><Divider />
            <SettingRow label="About FairBill" icon="file-text" disabled={busy} onPress={() => show('about')} />
            {hostedBuild && <><Divider /><SettingRow label="Tester access" icon="key" disabled={busy} onPress={() => show('invite')} /></>}
          </View>
        </View>
        {(privacyUrl || user) && <View style={ui.stack}>
          <SectionHeader>Account &amp; privacy</SectionHeader>
          <View style={settings.group}>
            {privacyUrl && <SettingRow label="Privacy notice" icon="shield" external disabled={busy} onPress={() => void run(() => Linking.openURL(privacyUrl))} />}
            {!!privacyUrl && user && <Divider />}
            {user && <SettingRow label="Sign out" icon="log-out" disabled={busy} onPress={() => void run(() => endSession(false))} />}
          </View>
        </View>}
        {user && <View style={settings.danger}><SettingRow label="Delete account" icon="trash-2" danger disabled={busy} onPress={() => show('delete')} /></View>}
      </>}
      {panel === 'help' && <Card>
        <View style={ui.stack}>
          <Text style={ui.label}>Which bill should I add?</Text>
          <Text style={ui.body}>Use an itemised hospital bill with a charge on each line. Keep every page in frame if you scan it.</Text>
        </View>
        <Divider />
        <View style={ui.stack}>
          <Text style={ui.label}>How do I check a finding?</Text>
          <Text style={ui.body}>Confirm the extracted lines, run the review, and tap a finding to open its source.</Text>
        </View>
        {cloudBuild && <><Divider /><Text style={ui.body}>FairBill uses the internet to sign in, save cases, and review documents.</Text></>}
      </Card>}
      {panel === 'status' && <ConnectionStatus />}
      {panel === 'about' && <Card>
        <Mark size={44} />
        <SectionHeader>FairBill</SectionHeader>
        <Text style={ui.small}>Version {Constants.expoConfig?.version ?? '0.1.0'}</Text>
        <Text style={ui.body}>Review hospital charges and collect the evidence you want to share with billing.</Text>
      </Card>}
      {panel === 'invite' && <Card>
        <Input label="Tester invite code" accessibilityLabel="Tester invite code" value={invite} onChangeText={setInvite}
          autoCapitalize="none" secureTextEntry editable={!busy} />
        <Button label="Verify invite" icon="check" busy={busy} onPress={() => void run(async () => {
          await configureInvite(invite);
          onInvite?.();
          onClose();
        })} />
      </Card>}
      {panel !== 'main' && <Button label={panel === 'delete' ? 'Cancel' : 'Back to settings'} tone="ghost" disabled={busy} onPress={() => show('main')} />}
    </ScrollView>
    </KeyboardAvoidingView>;

  if (embedded && panel === 'main') return content;
  return <Sheet title={panelTitles[panel]} onClose={() => {
    if (busy) return;
    if (embedded) show('main'); else onClose();
  }}>{content}</Sheet>;
}

const settings = StyleSheet.create({
  title: { color: color.ink, fontFamily: font.display, fontSize: 40, lineHeight: 44 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: 20, backgroundColor: color.primaryContainer },
  identity: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: color.primary },
  caption: { color: color.primary, fontFamily: font.regular, fontSize: 14 },
  email: { color: color.onPrimaryContainer, fontFamily: font.semibold, fontSize: 18 },
  group: { backgroundColor: color.card, borderWidth: 1, borderColor: color.line, borderRadius: 18, overflow: 'hidden' },
  row: { minHeight: 54, paddingHorizontal: 16, paddingVertical: 12, gap: 14, alignItems: 'center', flexDirection: 'row' },
  pressed: { opacity: 0.62 },
  danger: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line },
});
