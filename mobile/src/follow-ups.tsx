import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { RadioButton } from 'react-native-paper';
import { request, type Case } from './api';
import type { components } from './generated/fairbill-v1';
import { useFairBillTheme } from './theme';
import { Badge, Button, Card, Input, Message, SectionHeader, Sheet } from './ui';

type FollowUp = components['schemas']['FollowUp'];
type Status = FollowUp['status'];
const statuses: { value: Status; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];
const statusLabels = { open: 'Open', completed: 'Completed', cancelled: 'Cancelled' };

function localDate() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function FollowUps({ data, onUpdate, onClose }:
  { data: Case; onUpdate: (updated: Case) => void; onClose: () => void }) {
  const { ui } = useFairBillTheme();
  const [editing, setEditing] = useState<FollowUp>();
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState(localDate);
  const [status, setStatus] = useState<Status>('open');
  const [reference, setReference] = useState('');
  const [outcome, setOutcome] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const entries = [...(data.follow_ups ?? [])].sort((one, two) =>
    Number(two.status === 'open') - Number(one.status === 'open') || one.due_on.localeCompare(two.due_on));

  function open(entry?: FollowUp) {
    setEditing(entry);
    setTitle(entry?.title ?? '');
    setDueOn(entry?.due_on ?? localDate());
    setStatus(entry?.status ?? 'open');
    setReference(entry?.reference ?? '');
    setOutcome(entry?.outcome ?? '');
    setError('');
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError('');
    const base = `/cases/${data.id}/follow-ups`;
    const common = { revision: data.revision, due_on: dueOn.trim() };
    try {
      const updated = await request<Case>(editing ? `${base}/${editing.id}` : base, {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing
          ? { ...common, status, reference: status === 'open' ? '' : reference,
            outcome: status === 'open' ? '' : outcome, confirmed: true }
          : { ...common, title: title.trim() }),
      });
      onUpdate(updated);
      open();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <Sheet title="Follow-ups" onClose={() => { if (!busy) onClose(); }}>
    <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
      <Text style={ui.body}>Keep track of when to check back and what the hospital or insurer told you.</Text>
      {error ? <Message text={error} /> : null}
      <Card>
        <SectionHeader>{editing ? 'Update follow-up' : 'Add a follow-up'}</SectionHeader>
        {editing ? <Text style={ui.label}>{editing.title}</Text> : <Input label="What will you follow up on?"
          value={title} onChangeText={setTitle} maxLength={100} disabled={busy} />}
        <Input label="Due date (YYYY-MM-DD)" value={dueOn} onChangeText={setDueOn} maxLength={10} disabled={busy} />
        {editing && <>
          <RadioButton.Group value={status} onValueChange={(value) => setStatus(value as Status)}>
            {statuses.map((item) => <RadioButton.Item key={item.value} value={item.value} label={item.label} disabled={busy} />)}
          </RadioButton.Group>
          {status !== 'open' && <>
            <Input label="Reference number (optional)" value={reference} onChangeText={setReference} maxLength={100} disabled={busy} />
            <Input label="What happened?" value={outcome} onChangeText={setOutcome} multiline maxLength={500} disabled={busy} />
          </>}
        </>}
        <Button label={editing ? status === 'open' ? 'Save new date' : 'Confirm and save outcome' : 'Add follow-up'}
          icon="check" disabled={!dueOn.trim() || (!editing && !title.trim()) || (status === 'completed' && !outcome.trim())}
          busy={busy} onPress={() => void save()} />
        {editing && <Button label="Cancel editing" tone="ghost" disabled={busy} onPress={() => open()} />}
      </Card>
      {entries.map((entry) => <Card key={entry.id}>
        <View style={ui.between}>
          <Text style={[ui.label, ui.grow]}>{entry.title}</Text>
          <Badge tone={entry.status === 'completed' ? 'green' : 'neutral'}>{statusLabels[entry.status]}</Badge>
        </View>
        <Text style={ui.small}>Due {entry.due_on}</Text>
        {!!entry.reference && <Text style={ui.small}>Reference {entry.reference}</Text>}
        {!!entry.outcome && <Text style={ui.body}>{entry.outcome}</Text>}
        <Button label="Update follow-up" tone="ghost" disabled={busy} onPress={() => open(entry)} />
      </Card>)}
    </ScrollView>
  </Sheet>;
}
