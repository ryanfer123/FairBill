import { useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { Checkbox, Chip } from 'react-native-paper';
import { money, request, type Case, type Document, type Kind } from './api';
import type { components } from './generated/fairbill-v1';
import { Button, Card, Message, SectionHeader, Sheet, ui } from './ui';

type Review = 'tariff' | 'aid' | 'insurance';
type Category = 'NC' | 'C' | 'B' | 'A' | 'D' | 'FN' | 'F' | 'BP';
const policyVersions = ['NIAHLIP25040V082425', 'NIAHLIP25040V102425'] as const;
type Result = components['schemas']['PilotReview'];
const categories: Category[] = ['NC', 'C', 'B', 'A', 'D', 'FN'];

function DocumentChoice({ choices, kind, value, setValue, busy }:
  { choices: Document[]; kind: Kind; value: string; setValue: (value: string) => void; busy: boolean }) {
  if (!choices.length) return <Text style={ui.small}>Add and confirm a {kind} document first.</Text>;
  if (choices.length === 1) return null;
  return <View style={ui.stack}>
    <Text style={ui.label}>Choose the {kind} document</Text>
    {choices.map((doc, index) => <Chip key={doc.id} disabled={busy} selected={value === doc.id} onPress={() => setValue(doc.id)}
      accessibilityState={{ selected: value === doc.id }}>{`${kind} ${index + 1} · ${doc.pages.length} page(s)`}</Chip>)}
  </View>;
}

export function IndiaReview({ data, initial, onClose }: { data: Case; initial: Review; onClose: () => void }) {
  const [mode, setMode] = useState<Review>(initial);
  const [category, setCategory] = useState<Category>();
  const [uin, setUin] = useState<typeof policyVersions[number]>();
  const [selected, setSelected] = useState<Partial<Record<Kind, string>>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const choices = (kind: Kind) => data.documents.filter((doc) => doc.confirmed && doc.kind === kind);
  const id = (kind: Kind) => selected[kind] ?? (choices(kind).length === 1 ? choices(kind)[0]?.id : undefined);
  const invoice = id('invoice');
  const policy = id('policy');
  const settlement = id('settlement');
  const clear = () => { setResult(undefined); setError(''); };
  const allowed = !!invoice && (mode === 'insurance' ? !!(policy && settlement && uin && confirmed)
    : !!(category && (mode === 'aid' || confirmed)));

  async function run() {
    if (!allowed || busy) return;
    clear();
    setBusy(true);
    const common = { review: mode, invoice_id: invoice, revision: data.revision };
    const payload = mode === 'insurance' ? {
      ...common, policy_id: policy, settlement_id: settlement,
      uin, confirmed_applicability: confirmed,
    } : mode === 'tariff' ? {
      ...common, category, edition: 'tmh-parel-2026-11-01-v6', confirmed_applicability: confirmed,
    } : { ...common, category, hospital: 'tmh-parel' };
    try {
      setResult(await request<Result>(`/cases/${data.id}/india-review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      }));
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  const modes = [{ id: 'tariff', label: 'Published rates' }, { id: 'aid', label: 'Financial assistance' },
    { id: 'insurance', label: 'Insurance deductions' }] as const;
  return <Sheet title="India source review" onClose={() => { if (!busy) onClose(); }}>
    <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
      <View style={ui.stack}>{modes.map((item) => <Chip key={item.id} selected={mode === item.id} disabled={busy}
        accessibilityState={{ selected: mode === item.id }} onPress={() => { setMode(item.id); setCategory(undefined); setConfirmed(false); clear(); }}>{item.label}</Chip>)}</View>
      <Card>
        <SectionHeader>{mode === 'insurance' ? 'New India Mediclaim' : 'Tata Memorial Hospital, Parel'}</SectionHeader>
        <DocumentChoice choices={choices('invoice')} kind="invoice" busy={busy} value={invoice ?? ''} setValue={(value) => {
          setSelected({ ...selected, invoice: value }); setConfirmed(false); clear();
        }} />
        {mode !== 'insurance' ? <>
          <Text style={ui.body}>{mode === 'tariff' ? 'Select the category printed on the bill. This pilot covers room and ICU daily rates, codes B001 and B003, from 1–24 November 2026.'
            : 'Select the category shown on your Tata Memorial Hospital bill for guidance from the patient booklet.'}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(mode === 'aid' ? [...categories, 'BP', 'F'] as Category[] : categories).map((item) => <Chip key={item}
            selected={category === item} disabled={busy} accessibilityState={{ selected: category === item }}
            onPress={() => { setCategory(item); setConfirmed(false); clear(); }}>{item}</Chip>)}</View>
        </> : <>
          <Text style={ui.body}>Choose the UIN printed on the issued policy. This review flags room-related deduction questions under clause 3.2.</Text>
          {policyVersions.map((item) => <Chip key={item} selected={uin === item} disabled={busy}
            onPress={() => { setUin(item); setConfirmed(false); clear(); }}>{item}</Chip>)}
          {(['policy', 'settlement'] as const).map((kind) => <DocumentChoice key={kind} choices={choices(kind)} kind={kind} busy={busy}
            value={id(kind) ?? ''} setValue={(value) => { setSelected({ ...selected, [kind]: value }); setConfirmed(false); clear(); }} />)}
        </>}
        {mode !== 'aid' && <Checkbox.Item status={confirmed ? 'checked' : 'unchecked'} disabled={busy}
          label={mode === 'tariff'
            ? 'I checked the Parel campus, category, tariff edition and billed days. The charges use this published tariff.'
            : 'The policy dates and UIN match this bill and settlement. I checked the schedule and endorsements for changes to this clause.'}
          onPress={() => { setConfirmed(!confirmed); clear(); }} />}
        <Button label="Review sources" icon="search" disabled={!allowed} busy={busy} onPress={() => void run()} />
      </Card>
      {error ? <Message text={error} /> : null}
      {result && <>
        <Text style={ui.body}>{result.note}</Text>
        {result.findings.map((finding, i) => <Card key={`${finding.citation}-${i}`}>
          <SectionHeader>{finding.title}</SectionHeader>
          <Text style={ui.body}>{finding.detail}</Text>
          {finding.difference_paise != null && finding.billed_paise != null && finding.reference_paise != null && <>
            <Text style={ui.body}>{`Billed ${money(finding.billed_paise)} · Published ${money(finding.reference_paise)}`}</Text>
            <Text style={ui.label}>{`Difference ${money(finding.difference_paise)}`}</Text>
          </>}
          {finding.record && <Text selectable style={ui.small}>{`Page ${finding.record.page}, line ${finding.record.line}\n${finding.record.quote}`}</Text>}
          <Text style={ui.small}>{finding.citation}</Text>
          <Button label="Open official source" icon="external-link" tone="ghost"
            onPress={() => void Linking.openURL(finding.source_url).catch(() => setError('Could not open the source.'))} />
        </Card>)}
      </>}
    </ScrollView>
  </Sheet>;
}
