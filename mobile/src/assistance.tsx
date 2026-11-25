import { AppIcon } from './icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { hostedBuild, parseRupees, request, type AssistanceResult } from './api';
import { ActionBar, Badge, Button, Card, EmptyState, Input, Message, SectionHeader, Sheet, color, ui } from './ui';

export function Assistance({ caseId, revision, onClose }: { caseId: string; revision: number; onClose: () => void }) {
  const [income, setIncome] = useState('');
  const [size, setSize] = useState('');
  const [result, setResult] = useState<AssistanceResult>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'sample' | 'custom' | null>(null);

  async function check(useSample: boolean) {
    setError('');
    setResult(undefined);
    setBusy(useSample ? 'sample' : 'custom');
    try {
      let payload: object = { revision };
      if (!useSample) {
        const paise = parseRupees(income);
        if (paise == null) throw new Error('Enter a fictional annual household income.');
        if (!/^([1-9]|[12][0-9]|30)$/.test(size.trim())) throw new Error('Enter a household size from 1 to 30.');
        payload = { revision, annual_household_income_paise: paise, household_size: Number(size.trim()) };
      }
      const response = await request<AssistanceResult>(
        `/cases/${caseId}/assistance${useSample ? '/sample' : ''}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
      );
      setResult(response);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(null); }
  }

  return <Sheet title="Help with paying" onClose={() => { if (!busy) onClose(); }}>
    <KeyboardAvoidingView style={ui.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
        <Card tone="tonal">
          <View style={ui.row}>
            <AppIcon name="heart" size={22} color={color.primary} />
            <SectionHeader>Assistance screening</SectionHeader>
          </View>
          <Badge tone="amber">Fictional policy</Badge>
          <Text style={ui.body}>See how the sample policy would treat a fictional household. Each result cites the clause it used.</Text>
        </Card>
        {!hostedBuild && <Card>
          <Input label="Annual household income in rupees" accessibilityLabel="Annual household income in rupees"
            keyboardType="decimal-pad" value={income} onChangeText={setIncome} editable={!busy} />
          <Input label="Household size" accessibilityLabel="Household size" keyboardType="number-pad"
            value={size} onChangeText={setSize} maxLength={2} editable={!busy} />
          <Button label="Screen fictional household" icon="search" tone="ghost" disabled={!!busy}
            busy={busy === 'custom'} onPress={() => void check(false)} />
        </Card>}
        {error ? <Message text={error} /> : null}
        {result && <>
          <SectionHeader>Policy findings</SectionHeader>
          {!result.findings.length && <EmptyState>No assistance findings were returned.</EmptyState>}
          {result.findings.map((finding) => <Card key={finding.id}>
            <Badge tone="neutral">{finding.status.replace(/_/g, ' ')}</Badge>
            <Text style={ui.label}>{finding.title}</Text>
            <Text style={ui.body}>{finding.explanation}</Text>
            <Text style={ui.kicker}>Clause {finding.source.row_id} · Page {finding.source.page}, line {finding.source.line}</Text>
            {finding.source.quote && <Text selectable style={ui.body}>{finding.source.quote}</Text>}
            <Text style={ui.small}>This policy citation still needs applicability review.</Text>
          </Card>)}
        </>}
      </ScrollView>
      <ActionBar><Button label="Run sample screening" icon="search" disabled={!!busy}
        busy={busy === 'sample'} onPress={() => void check(true)} /></ActionBar>
    </KeyboardAvoidingView>
  </Sheet>;
}
