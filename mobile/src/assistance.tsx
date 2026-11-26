import { useFairBillTheme } from './theme';
import { AppIcon } from './icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView, Text, View } from 'react-native';
import { hostedBuild, parseRupees, request, type AssistanceResult } from './api';
import { accountUser } from './cloud-auth';
import { HospitalPolicyLookup } from './hospital-policy-lookup';
import { ActionBar, Badge, Button, Card, EmptyState, Input, Message, SectionHeader, Sheet } from './ui';

const maharashtraScheme = 'https://nhm.maharashtra.gov.in/en/publication/mahatma-jyotirao-phule-jan-arogya-yojana/';

const tataBooklet = 'https://tmc.gov.in/event/upload/12112025_5/TMH_Brochure_%20patient%20booklet.pdf';

export function AssistanceSources({ onClose, lookup, onCategoryReview }: {
  onClose: () => void;
  lookup?: { caseId: string; revision: number; onRefreshCase: () => void };
  onCategoryReview?: () => void;
}) {
  const { ui } = useFairBillTheme();
  const [error, setError] = useState('');
  const state = accountUser()?.user_metadata?.home_state;
  return <Sheet title="Help with paying" onClose={onClose}>
    <ScrollView contentContainerStyle={ui.content}>
      {lookup && <HospitalPolicyLookup key={`${lookup.caseId}:${lookup.revision}`} {...lookup} />}
      <SectionHeader>General guidance</SectionHeader>
      <Text style={ui.body}>Ask your hospital’s billing or medical social work office about financial assistance and what documents they need.</Text>
      {error ? <Message text={error} onClose={() => setError('')} /> : null}
      {typeof state === 'string' && state.trim().toLowerCase() === 'maharashtra' && <Card>
        <SectionHeader>Maharashtra public health scheme</SectionHeader>
        <Text style={ui.body}>Check the published Mahatma Jyotirao Phule Jan Arogya Yojana information for eligibility and covered care.</Text>
        <Button label="Open Maharashtra scheme information" icon="external-link" tone="ghost"
          onPress={() => void Linking.openURL(maharashtraScheme).catch(() => setError('Could not open the scheme information.'))} />
      </Card>}
      <Card>
        <SectionHeader>Tata Memorial Hospital, Mumbai</SectionHeader>
        <Text style={ui.body}>If your bill is from Tata Memorial, section 14.2 of its patient booklet describes the hospital’s patient categories and means assessment.</Text>
        <Button label="Open the hospital’s patient booklet" icon="external-link" tone="ghost"
          onPress={() => void Linking.openURL(tataBooklet).catch(() => setError('Could not open the patient booklet.'))} />
        {onCategoryReview && <Button label="Review a Parel bill category" tone="ghost" onPress={onCategoryReview} />}
      </Card>
    </ScrollView>
  </Sheet>;
}

export function Assistance({ caseId, revision, onClose }: { caseId: string; revision: number; onClose: () => void }) {
  const { ui, color } = useFairBillTheme();
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
