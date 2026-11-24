import Constants from 'expo-constants';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView, Text } from 'react-native';
import { forgetCase, request } from './api';
import { accountUser, confirmSignInLink, requestSignInCode, restoreAccount, signOutAccount, verifySignInCode } from './cloud-auth';
import { Button, Card, Input, Mark, Message, Screen, SectionHeader, Sheet, ui } from './ui';

const privacyUrl: string | undefined = Constants.expoConfig?.extra?.fairbillPrivacyUrl;

export function SignIn({ restoring }: { restoring: boolean }) {
  const [email, setEmail] = useState('');
  const [destination, setDestination] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(restoring);
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
        <Mark size={48} />
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
  </Screen>;
}

export function AccountSettings({ onClose }: { onClose: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  async function endSession(deleteAccount: boolean) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (deleteAccount) {
        await forgetCase();
        await request<void>('/account', { method: 'DELETE' });
      }
      await signOutAccount(deleteAccount);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <Sheet title={confirm ? 'Delete your account' : 'Your account'} onClose={() => { if (!busy) onClose(); }}>
    <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
      {error ? <Message text={error} /> : null}
      {confirm ? <Card>
        <Text style={ui.body}>This permanently deletes your account, saved cases and uploaded bills.</Text>
        <Input label="Type DELETE to confirm" accessibilityLabel="Type DELETE to confirm" value={confirmation}
          onChangeText={setConfirmation} autoCapitalize="characters" autoCorrect={false} editable={!busy} />
        <Button label="Permanently delete account" icon="trash-2" busy={busy} disabled={confirmation !== 'DELETE'}
          onPress={() => void endSession(true)} />
        <Button label="Cancel" tone="ghost" disabled={busy} onPress={() => { setConfirm(false); setConfirmation(''); }} />
      </Card> : <>
        <Text style={ui.body}>{accountUser()?.email}</Text>
        {privacyUrl && <Button label="Privacy notice" tone="ghost" disabled={busy}
          onPress={() => void Linking.openURL(privacyUrl).catch(() => setError('Could not open the privacy notice.'))} />}
        <Button label="Sign out" icon="log-out" busy={busy} onPress={() => void endSession(false)} />
        <Button label="Delete account" icon="trash-2" tone="ghost" disabled={busy} onPress={() => setConfirm(true)} />
      </>}
    </ScrollView>
  </Sheet>;
}
