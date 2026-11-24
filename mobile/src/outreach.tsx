import { Feather } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Action, Draft, Receipt } from './api';
import { ActionBar, Badge, Button, Card, Divider, EmptyState, Input, Message, SectionHeader, Sheet, color, ui } from './ui';

export type SimulationStep = 'start' | 'identity' | 'identity_failed' | 'finish';
const speakerNames = { system: 'Call status', patient: 'Patient', advocate: 'Advocate', billing: 'Billing desk' };

function Turn({ speaker, patient, children }: { speaker: string; patient?: boolean; children: ReactNode }) {
  return <View style={[styles.turn, patient && styles.patient]}>
    <View style={ui.row}>
      <Feather name={patient ? 'user' : 'message-circle'} size={15} color={color.forest} />
      <Text style={ui.label}>{speaker}</Text>
    </View>
    <Text style={ui.body}>{children}</Text>
  </View>;
}

function Transcript({ draft, receipt }: { draft: Draft; receipt: Receipt }) {
  const pending = receipt.state === 'awaiting_identity';
  const failed = receipt.outcome === 'identity_failed';
  return <View style={ui.stack}>
    <SectionHeader>Simulated call transcript</SectionHeader>
    <Badge tone={pending || failed ? 'amber' : 'green'}>
      {failed ? 'Ended before verification' : receipt.state === 'completed' ? 'Simulation complete' : pending ? 'Identity verification required' : 'Identity verified'}
    </Badge>
    {receipt.turns?.length ? receipt.turns.map((turn, index) => <Turn key={index}
      speaker={speakerNames[turn.speaker]} patient={turn.speaker === 'patient'}>{turn.text}</Turn>) : <>
      <Turn speaker="Billing desk">Please verify your identity.</Turn>
      <Turn speaker="Patient" patient>{pending ? 'Identity verification pending.' : 'Identity verified.'}</Turn>
      {receipt.state === 'completed' && <>
        <Turn speaker="Advocate">{draft.text}</Turn>
        <Turn speaker="Billing desk">The billing desk acknowledged the requests. Reference {receipt.id}.</Turn>
      </>}
    </>}
    {receipt.state === 'completed' && !failed && <Text style={ui.label}>Reference {receipt.id}</Text>}
  </View>;
}

export function Outreach({ action, draft, receipt, approved, busy, error, live = false, onDismissError, onClose, onApprove, onSimulate, onEdit }:
  { action: Action; draft?: Draft; receipt?: Receipt; approved: boolean; busy: string; error: string; live?: boolean;
    onDismissError: () => void; onClose: () => void; onApprove: () => void;
    onSimulate: (step: SimulationStep) => void; onEdit?: (text: string) => Promise<void> }) {
  const call = action === 'call';
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [destination, setDestination] = useState('');
  const [handoffError, setHandoffError] = useState('');
  const activeCall = call && !!receipt;
  const pending = receipt?.state === 'awaiting_identity';
  const complete = receipt?.state === 'completed';
  const terminal = complete || receipt?.progress === 'ENDED';

  async function saveEdit() {
    try {
      await onEdit?.(text);
      setEditing(false);
    } catch {
      // The route displays the server's message.
    }
  }

  async function openPhoneApp() {
    if (!approved || !draft || !live || busy) return;
    setHandoffError('');
    const target = call ? destination.replace(/[\s()-]/g, '') : destination.trim();
    if (call ? !/^\+?\d{6,15}$/.test(target) : !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(target)) {
      setHandoffError(call ? 'Enter the billing desk’s phone number.' : 'Enter the billing desk’s email address.');
      return;
    }
    try {
      const url = call ? `tel:${target}`
        : `mailto:${encodeURIComponent(target.split('@')[0]!)}@${target.split('@')[1]}?subject=Hospital%20bill%20clarification&body=${encodeURIComponent(draft.text)}`;
      await Linking.openURL(url);
    } catch {
      setHandoffError(call ? 'Your phone could not open the dialer.' : 'Your phone could not open an email app.');
    }
  }

  return <Sheet title={call ? live ? 'Billing call script' : 'Three-way call plan' : 'Clarification letter'} onClose={onClose}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={ui.content}>
      {!live && <Badge tone="amber">Simulated outreach</Badge>}
      {error ? <Message text={error} onClose={onDismissError} /> : null}
      {handoffError ? <Message text={handoffError} onClose={() => setHandoffError('')} /> : null}
      {!draft ? <EmptyState>The draft for this revision is unavailable. Close this view and prepare a new draft.</EmptyState>
        : activeCall && receipt ? <Transcript draft={draft} receipt={receipt} /> : <>
          <Card tone="tonal">
            <View style={ui.row}>
              <Feather name={call ? 'phone-call' : 'mail'} size={22} color={color.forest} />
              <View style={ui.grow}>
                <SectionHeader>{call ? 'Review the call plan' : 'Review the exact letter'}</SectionHeader>
                <Text style={ui.small}>Revision {draft.revision} · {draft.mode} draft</Text>
              </View>
            </View>
            {approved && <Badge>Approved · Locked</Badge>}
          </Card>
          <Card>
            {editing ? <Input value={text} onChangeText={setText} label="Exact letter text"
              accessibilityLabel="Exact letter text" multiline maxLength={18000} style={styles.editor} />
              : <Text selectable style={[ui.body, styles.exact]}>{draft.text}</Text>}
            {onEdit && !receipt && !editing && <>
              <Divider />
              <Button label="Edit letter" icon="edit-2" tone="ghost" disabled={!!busy}
                onPress={() => { setText(draft.text); setEditing(true); }} />
            </>}
            {editing && <Text style={ui.small}>Saving new wording requires a new approval.</Text>}
          </Card>
          {!approved && !editing && <Text style={ui.body}>Approval applies to this exact wording and case revision.</Text>}
          {live && approved && !editing && <Card>
            <Input label={call ? 'Billing phone number' : 'Billing email address'} value={destination}
              onChangeText={setDestination} keyboardType={call ? 'phone-pad' : 'email-address'}
              autoCapitalize="none" autoCorrect={false} maxLength={call ? 30 : 320} />
            <Text style={ui.small}>{call ? 'Check the number against your bill. You place the call in your dialer.'
              : 'Check the address against your bill. You send the letter from your email app.'}</Text>
          </Card>}
          {receipt && <Card tone="tonal">
            <Badge>Simulation complete</Badge>
            <Text style={ui.label}>Reference {receipt.id}</Text>
            <Text style={ui.body}>The simulated send was recorded in the case timeline.</Text>
          </Card>}
        </>}
    </ScrollView>
    {draft && !terminal && <ActionBar>
      {editing ? <>
        <Button label="Save letter edits" icon="check" busy={busy === 'edit-letter'}
          disabled={!text.trim() || text === draft.text || !!busy} onPress={() => void saveEdit()} />
        <Button label="Cancel edit" tone="ghost" disabled={!!busy} onPress={() => setEditing(false)} />
      </> : !approved ? <Button label="Approve exact wording" icon="check"
        busy={busy === 'approve'} disabled={!!busy} onPress={onApprove} />
        : live ? <Button label={call ? 'Open phone dialer' : 'Open email draft'} icon={call ? 'phone' : 'mail'}
          disabled={!!busy || !destination.trim()} onPress={() => void openPhoneApp()} />
        : !receipt ? <Button label={call ? 'Start simulated call' : 'Simulate sending letter'}
          icon={call ? 'phone-call' : 'send'} busy={busy === 'simulation'} disabled={!!busy} onPress={() => onSimulate('start')} />
          : activeCall && <>
            {pending && <Button label="I verified my identity" icon="user-check" busy={!!busy} onPress={() => onSimulate('identity')} />}
            {pending && receipt?.progress && <Button label="I couldn’t verify" tone="ghost" disabled={!!busy}
              onPress={() => onSimulate('identity_failed')} />}
            <Button label="Continue the call" icon="arrow-right" disabled={pending} busy={!!busy && !pending}
              onPress={() => onSimulate('finish')} />
          </>}
    </ActionBar>}
  </Sheet>;
}

const styles = StyleSheet.create({
  turn: { padding: 15, borderRadius: 16, borderWidth: 1, borderColor: color.line, backgroundColor: color.card, gap: 6 },
  patient: { marginLeft: 22, borderColor: 'transparent', backgroundColor: color.pale },
  exact: { color: color.ink },
  editor: { minHeight: 200 },
});
