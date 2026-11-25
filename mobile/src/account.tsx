import Constants from 'expo-constants';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView, Text, View } from 'react-native';
import { configureInvite, forgetCase, hostedBuild, request } from './api';
import { accountUser, cloudBuild, confirmSignInLink, requestSignInCode, restoreAccount, signOutAccount, verifySignInCode } from './cloud-auth';
import { Button, Card, Divider, IconButton, Input, Mark, Message, Screen, SectionHeader, Sheet, ui } from './ui';

const privacyUrl: string | undefined = Constants.expoConfig?.extra?.fairbillPrivacyUrl;

export function SignIn({ restoring }: { restoring: boolean }) {
  const [email, setEmail] = useState('');
  const [destination, setDestination] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(restoring);
  const [settings, setSettings] = useState(false);
  const pending = useRef(false);

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

  async function send() {
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Enter a valid email address.');
    await requestSignInCode(value);
    setCode('');
    setDestination(value);
  }

  return <Screen>
    <KeyboardAvoidingView style={ui.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
        <View style={ui.between}><Mark size={48} /><IconButton label="Settings" icon="settings" onPress={() => setSettings(true)} /></View>
        <Text accessibilityRole="header" style={ui.title}>FairBill</Text>
        <Text style={ui.body}>Sign in to review a bill and pick up where you left off on another device.</Text>
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

const panelTitles = { main: 'Settings', help: 'Help with a bill', about: 'About FairBill', delete: 'Delete your account', invite: 'Tester access' };

export function AccountSettings({ onClose, onInvite }: { onClose: () => void; onInvite?: () => void }) {
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

  return <Sheet title={panelTitles[panel]} onClose={() => { if (!busy) onClose(); }}>
    <KeyboardAvoidingView style={ui.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView key={panel} contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
      {error ? <Message text={error} /> : null}
      {panel === 'delete' && <Card>
        <Text style={ui.body}>This permanently deletes your account, saved cases and uploaded bills.</Text>
        <Input label="Type DELETE to confirm" accessibilityLabel="Type DELETE to confirm" value={confirmation}
          onChangeText={setConfirmation} autoCapitalize="characters" autoCorrect={false} editable={!busy} />
        <Button label="Permanently delete account" icon="trash-2" busy={busy} disabled={confirmation !== 'DELETE'}
          onPress={() => void run(() => endSession(true))} />
      </Card>}
      {panel === 'main' && <>
        {user && <Card>
          <SectionHeader>Account</SectionHeader>
          {!!user.email && <Text style={ui.body}>{user.email}</Text>}
          <Button label="Sign out" icon="log-out" tone="ghost" busy={busy} onPress={() => void run(() => endSession(false))} />
        </Card>}
        <Card>
          <SectionHeader>Support</SectionHeader>
          <Button label="Help with a bill" icon="help-circle" tone="ghost" disabled={busy} onPress={() => show('help')} />
          <Button label="About FairBill" icon="file-text" tone="ghost" disabled={busy} onPress={() => show('about')} />
          {hostedBuild && <Button label="Tester access" icon="key" tone="ghost" disabled={busy} onPress={() => show('invite')} />}
        </Card>
        {(privacyUrl || user) && <Card>
          <SectionHeader>Privacy and data</SectionHeader>
          {privacyUrl && <Button label="Privacy notice" icon="shield" tone="ghost" disabled={busy}
            onPress={() => void run(() => Linking.openURL(privacyUrl))} />}
          {user && <Button label="Delete account" icon="trash-2" tone="destructive" disabled={busy} onPress={() => show('delete')} />}
        </Card>}
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
    </KeyboardAvoidingView>
  </Sheet>;
}
