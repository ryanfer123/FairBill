import { Feather } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Action, Draft, Receipt } from './api';
import { Badge, Button, Card, Divider, EmptyState, Message, SectionHeader, Sheet, color, ui } from './ui';

type SimulationStep = 'start' | 'identity' | 'finish';

function Turn({ speaker, patient, children }: { speaker: string; patient?: boolean; children: ReactNode }) {
  return <View style={[styles.turn, patient && styles.patient]}>
    <Text style={ui.kicker}>{speaker.toUpperCase()}</Text>
    <Text style={ui.body}>{children}</Text>
  </View>;
}

function CallTranscript({ draft, receipt, busy, onSimulate }:
  { draft: Draft; receipt: Receipt; busy: boolean; onSimulate: (step: SimulationStep) => void }) {
  const [opening, wait, ...requests] = draft.text.split('\n\n');
  const awaitingIdentity = receipt.state === 'awaiting_identity';
  return <Card>
    <SectionHeader>Simulated call transcript</SectionHeader>
    <Badge tone="neutral">Patient and billing connected</Badge>
    <Turn speaker="Advocate">{[opening, wait].filter(Boolean).join('\n\n')}</Turn>
    <Turn speaker="Billing desk">Please verify your identity.</Turn>
    {awaitingIdentity ? <>
      <Turn speaker="Patient" patient>Identity verification pending.</Turn>
      <Button label="I verified my identity" icon="user-check" busy={busy} onPress={() => onSimulate('identity')} />
      <Text style={ui.small}>The advocate’s next turn unlocks after the patient verifies.</Text>
    </> : <Turn speaker="Patient" patient>Identity verified.</Turn>}
    {receipt.state !== 'completed' && <Button label="Continue the call" icon="arrow-right"
      disabled={awaitingIdentity} busy={busy && !awaitingIdentity} onPress={() => onSimulate('finish')} />}
    {receipt.state === 'completed' && <>
      {!!requests.length && <Turn speaker="Advocate">{requests.join('\n\n')}</Turn>}
      <Turn speaker="Billing desk">The billing desk acknowledged the requests. Reference {receipt.id}.</Turn>
      <Badge>Simulation complete</Badge>
    </>}
  </Card>;
}

export function Outreach({ action, draft, receipt, approved, busy, error, onDismissError, onClose, onApprove, onSimulate }:
  { action: Action; draft?: Draft; receipt?: Receipt; approved: boolean; busy: string; error: string;
    onDismissError: () => void; onClose: () => void; onApprove: () => void;
    onSimulate: (step: SimulationStep) => void }) {
  const call = action === 'call';
  return <Sheet title={call ? 'Three-way call plan' : 'Clarification letter'} onClose={onClose}>
    <ScrollView contentContainerStyle={ui.content}>
      <Badge tone="amber">Simulated outreach</Badge>
      {error ? <Message text={error} onClose={onDismissError} /> : null}
      {!draft ? <EmptyState>The draft for this revision is unavailable. Close this view and prepare a new draft.</EmptyState> : <>
        <Card>
          <View style={ui.between}>
            <Text style={[ui.kicker, ui.grow]}>EXACT WORDING · REVISION {draft.revision} · {draft.mode.toUpperCase()}</Text>
            {approved && <Feather name="lock" size={16} color={color.forest} />}
          </View>
          {approved && <Badge>Approved · Locked</Badge>}
          <Divider />
          <Text selectable style={[ui.body, { color: color.ink }]}>{draft.text}</Text>
        </Card>
        {!approved && <Card>
          <SectionHeader>Approve this exact text</SectionHeader>
          <Text style={ui.body}>Approval applies to this draft and case revision.</Text>
          <Button label="Approve exact wording" icon="check" busy={busy === 'approve'} disabled={!!busy} onPress={onApprove} />
        </Card>}
        {approved && !receipt && <Button label={call ? 'Start simulated call' : 'Simulate sending letter'}
          icon={call ? 'phone-call' : 'send'} busy={busy === 'simulation'} disabled={!!busy} onPress={() => onSimulate('start')} />}
        {receipt && (call ? <CallTranscript draft={draft} receipt={receipt} busy={!!busy} onSimulate={onSimulate} /> : <Card>
          <Badge>Simulation complete</Badge>
          <Text style={ui.label}>Reference {receipt.id}</Text>
          <Text style={ui.body}>The simulated send was recorded in the case timeline.</Text>
        </Card>)}
      </>}
    </ScrollView>
  </Sheet>;
}

const styles = StyleSheet.create({
  turn: { padding: 12, borderLeftWidth: 2, borderLeftColor: color.line, backgroundColor: color.paper, gap: 4 },
  patient: { borderLeftColor: color.forest, marginLeft: 12, backgroundColor: color.pale },
});
