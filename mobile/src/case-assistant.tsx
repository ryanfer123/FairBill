import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Action, Case, Kind } from './api';
import { classifyRequest, type Intent } from './case-intent';
import { Button, Card, Input, SectionHeader, Sheet, color, ui } from './ui';

export type AssistantAction =
  | { type: 'intake'; kind: Kind }
  | { type: 'document'; id: string }
  | { type: 'prepare'; action: Action }
  | { type: 'evidence' | 'result' | 'investigate' | 'packet' | 'assistance' | 'india-review' };

export type SavedPlan = { request: string; revision: number; intent: Intent };

type Props = {
  data: Case;
  busy: boolean;
  canAct: boolean;
  canAddEvidence: boolean;
  canReviewDocuments: boolean;
  supportsAssistance: boolean;
  supportsIndia: boolean;
  live: boolean;
  savedPlan?: SavedPlan;
  onPlan: (plan: SavedPlan) => void;
  onAction: (action: AssistantAction) => void;
  onClose: () => void;
};

const goals = {
  source: ['Find the bill source', 'Show the evidence behind a finding'],
  review: ['Check the extracted lines', 'Review the scanned charges'],
  investigate: ['Check the bill for issues', 'Check this bill for duplicate charges'],
  letter: ['Draft a clarification letter', 'Draft a letter to billing'],
  packet: ['Prepare an evidence packet', 'Create a redacted PDF packet'],
  call: ['Prepare for a billing call', 'Prepare a billing call script'],
  assistance: ['Find help paying the bill', 'Find financial assistance'],
} as const;
type Goal = Exclude<Intent, 'unknown'>;
type Step = { label: string; action: AssistantAction };

function makePlan(goal: Goal, props: Props): { steps: string[]; next?: Step; explanation?: string } {
  const { data, canReviewDocuments, canAddEvidence, canAct, supportsAssistance, supportsIndia, live } = props;
  const invoice = data.documents.find((doc) => doc.kind === 'invoice');
  const pending = data.documents.find((doc) => !doc.confirmed);
  const reviewed = data.investigated_revision === data.revision;
  const addBill = canAddEvidence ? { label: 'Add a bill', action: { type: 'intake', kind: 'invoice' } as const } : undefined;
  const pendingStep = pending && canReviewDocuments ? { label: 'Confirm the document lines',
    action: { type: 'document', id: pending.id } as const } : undefined;
  const run = { label: 'Run bill checks', action: { type: 'investigate' } as const };

  if (goal === 'assistance') {
    return { steps: ['Open available assistance resources', 'Check the published criteria'],
      next: live && supportsIndia ? { label: 'View assistance resources', action: { type: 'india-review' } }
        : supportsAssistance ? { label: 'Check financial assistance', action: { type: 'assistance' } } : undefined,
      explanation: supportsAssistance || supportsIndia ? undefined : 'Assistance resources are unavailable for this case.' };
  }
  if (goal === 'source' || goal === 'review') {
    const doc = pending ?? invoice ?? data.documents[0];
    const steps = goal === 'source' ? ['Open the evidence', 'Select a source line'] : ['Open the extracted lines', 'Check each amount against the bill'];
    if (!doc) return { steps: ['Add an itemised bill', ...steps], next: addBill };
    return { steps, next: goal === 'review' && canReviewDocuments
      ? { label: 'Open document lines', action: { type: 'document', id: doc.id } }
      : { label: 'Open evidence', action: { type: 'evidence' } } };
  }

  const finalStep: Step = goal === 'letter' ? { label: 'Draft a letter', action: { type: 'prepare', action: 'letter' } }
    : goal === 'call' ? { label: 'Prepare a call script', action: { type: 'prepare', action: 'call' } }
    : goal === 'packet' ? { label: 'Preview redacted PDF', action: { type: 'packet' } }
    : { label: 'Open review results', action: { type: 'result' } };
  const steps = [!invoice && 'Add an itemised bill', (pending || !invoice) && 'Confirm extracted lines',
    !reviewed && 'Run the bill checks', finalStep.label].filter((step): step is string => typeof step === 'string');
  if (!invoice) return { steps, next: addBill, explanation: addBill ? undefined : 'This case has no invoice.' };
  if (pending) return { steps, next: pendingStep, explanation: pendingStep ? undefined : 'This case has unconfirmed evidence.' };
  if (!reviewed) return { steps, next: run };
  if (goal !== 'investigate' && !canAct) return { steps, explanation: 'This case cannot prepare outreach or exports.' };

  const noFindings = data.findings.every((item) => item.status !== 'active');
  return { steps, next: finalStep, explanation: noFindings && (goal === 'letter' || goal === 'call')
    ? 'The current review has no open findings. You can still request an itemised bill.' : undefined };
}

export function CaseAssistant(props: Props) {
  const [request, setRequest] = useState(props.savedPlan?.request ?? '');
  const saved = props.savedPlan;
  const matching = saved?.request === request.trim() ? saved : undefined;
  const intent = matching?.intent;
  const confirmed = props.data.documents.filter(doc => doc.confirmed).length;
  const pending = props.data.documents.length - confirmed;
  const checked = props.data.investigated_revision === props.data.revision;
  const openFindings = props.data.findings.filter(finding => finding.status === 'active').length;
  const withdrawn = props.data.findings.filter(finding => finding.status === 'withdrawn').length;
  const plan = intent && intent !== 'unknown' ? makePlan(intent, props) : undefined;

  function submit(text: string, goal?: Goal) {
    setRequest(text);
    const intent = goal ?? classifyRequest(text).intent;
    props.onPlan({ request: text.trim(), revision: props.data.revision, intent });
  }

  return <Sheet title="Case assistant" onClose={props.onClose}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={ui.content}>
      <Text accessibilityRole="header" style={ui.title}>What would you like to do?</Text>
      {!matching && <View style={ui.stack}>
        <Button label={pending ? 'Check the extracted lines' : 'Check the bill for issues'}
          icon="check" tone="light" onPress={() => submit(pending ? goals.review[1] : goals.investigate[1], pending ? 'review' : 'investigate')} />
        <Button label="Request an itemised bill" icon="mail" tone="ghost"
          onPress={() => submit('Ask the hospital for an itemised bill', 'letter')} />
      </View>}
      <Text style={ui.small}>Your request is processed on this device.</Text>
      <Input label="Ask about this case" accessibilityLabel="Ask about this case" value={request}
        maxLength={240} onChangeText={setRequest}
        onSubmitEditing={() => { if (request.trim()) submit(request); }} />
      <Button label="Make a plan" icon="arrow-right" disabled={!request.trim() || props.busy}
        onPress={() => submit(request)} />
      {intent === 'unknown' && <Text style={ui.body}>Choose a task below or try a more specific request.</Text>}
      {plan && intent && intent !== 'unknown' && <Card>
        <Text accessibilityRole="header" style={ui.heading}>{goals[intent][0]}</Text>
        {matching && matching.revision !== props.data.revision &&
          <Text style={ui.small}>{pending ? 'New evidence needs confirmation. Review those lines before continuing.'
            : checked ? 'FairBill checked the updated case. The remaining steps use the current findings.'
            : 'The confirmed evidence changed. Run the checks again before continuing.'}</Text>}
        <SectionHeader>Case status</SectionHeader>
        <Text style={ui.body}>{confirmed} {confirmed === 1 ? 'document confirmed' : 'documents confirmed'}
          {pending ? ` · ${pending} awaiting confirmation` : ''}</Text>
        {checked && <Text style={ui.small}>{openFindings} open {openFindings === 1 ? 'question' : 'questions'}
          {withdrawn ? ` · ${withdrawn} withdrawn after review` : ''}</Text>}
        <SectionHeader>Next steps</SectionHeader>
        {plan.steps.map((step) => <View key={step} style={ui.row}>
          <View style={styles.dot} /><Text style={[ui.body, ui.grow]}>{step}</Text>
        </View>)}
        {!!plan.explanation && <Text style={ui.body}>{plan.explanation}</Text>}
        {plan.next && <Button label={plan.next.label} disabled={props.busy}
          onPress={() => { if (plan.next) props.onAction(plan.next.action); }} />}
      </Card>}
      <View style={ui.stack}>
        <Text accessibilityRole="header" style={ui.label}>Case tasks</Text>
        {(Object.keys(goals) as Goal[]).map((goal) => <Button key={goal} label={goals[goal][0]}
          tone="ghost" onPress={() => submit(goals[goal][1], goal)} />)}
      </View>
    </ScrollView>
  </Sheet>;
}

const styles = StyleSheet.create({
  dot: { backgroundColor: color.primary, borderRadius: 3, width: 6, height: 6 },
});
