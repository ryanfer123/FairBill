import { AppIcon } from './icons';
import Animated from 'react-native-reanimated';
import { Illustration } from './illustrations';
import { surfaceReveal } from './motion';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Case, Finding, History, KINDS, Source, money } from './api';
import { Disclosure } from './disclosure';
import { font } from './typography';
import { Badge, Button, Card, Divider, EmptyState, SectionHeader, Sheet, color, ui } from './ui';

const RELATION: Record<Source['relation'], string> = {
  supports: 'Supports the question', contradicts: 'Challenges the question',
  context: 'Related evidence', patient_report: 'Patient report',
};

const RULES: Record<string, string> = {
  duplicates: 'Repeated charges and distinct service orders',
  quantities: 'Billed and documented quantities',
  settlement: 'Settlement deductions and cited policy clauses',
  patient_report: 'Patient-reported service receipt',
  line_arithmetic: 'Line quantity times unit price',
  daily_unit_limit: 'Fictional daily unit limit',
  tariff: 'Fictional reference tariff',
  bill_total: 'Invoice total and sum of lines',
};

export interface EvidenceView {
  title: string;
  rule?: string;
  explanation: string;
  amount: number | null;
  evidence: Source[];
  status?: Finding['status'];
  selected?: number;
}

function sourceKey(source: Source) {
  return `${source.document_id}:${source.row_id}:${source.page}:${source.line}`;
}

function unique(sources: Source[]) {
  return [...new Map(sources.map((source) => [sourceKey(source), source])).values()];
}

const sourceNames: Record<Source['document_kind'], string> = {
  invoice: 'Invoice', policy: 'Policy', settlement: 'Settlement', service_record: 'Service record',
};

function sourceLabel(source: Source) {
  const name = source.document_id === 'second-order' ? 'Second lab order' : sourceNames[source.document_kind];
  return `${name} p.${source.page} · l.${source.line}`;
}

function SourceChips({ evidence, onPress }: { evidence: Source[]; onPress: (index: number) => void }) {
  if (!evidence.length) return null;
  return <View style={styles.chips}>
    {evidence.map((source, index) => <Pressable key={sourceKey(source)} accessibilityRole="button"
      accessibilityLabel={`View ${KINDS[source.document_kind]}, page ${source.page}, line ${source.line}`}
      onPress={() => onPress(index)} style={styles.chip}>
      <AppIcon name="file-text" size={14} color={color.primary} />
      <Text style={[ui.small, styles.chipLabel]}>{sourceLabel(source)}</Text>
    </Pressable>)}
  </View>;
}

function LedgerLine({ entry, subtract = false, supportingText, onEvidence }:
  { entry: EvidenceView; subtract?: boolean; supportingText?: string; onEvidence: (entry: EvidenceView) => void }) {
  const amount = subtract && entry.amount !== null ? money(-entry.amount) : money(entry.amount);
  return <View style={styles.ledgerLine}>
    <View style={ui.between}>
      <Text style={[ui.label, ui.grow]}>{entry.title}</Text>
      <Text selectable style={[ui.money, styles.value]}>{amount}</Text>
    </View>
    {!!supportingText && <Text style={ui.small}>{supportingText}</Text>}
    {entry.amount !== null && entry.evidence.length > 0 && <Pressable accessibilityRole="button"
      accessibilityLabel={`View sources for ${entry.title}`} onPress={() => onEvidence(entry)} style={styles.ledgerSource}>
      <AppIcon name="file-text" size={14} color={color.primary} />
      <Text style={styles.chipLabel}>{entry.evidence.length === 1 ? sourceLabel(entry.evidence[0]!)
        : `${entry.evidence.length} sources`}</Text>
    </Pressable>}
  </View>;
}

function invoiceSources(data: Case): Source[] {
  return data.documents.flatMap((doc) => doc.confirmed && doc.kind === 'invoice'
    ? doc.rows.filter((row) => row.type === 'invoice_total').map((row) => ({
      document_id: doc.id, document_kind: doc.kind, sha256: doc.sha256,
      page: row.page, line: row.line, row_id: row.id,
      quote: doc.pages[row.page - 1]?.split(/\r?\n/)[row.line - 1] ?? '',
      relation: 'context',
      basis: doc.edited_rows?.includes(row.id) ? 'patient_confirmed' : 'document',
    })) : []);
}

const conditionalTitle = 'Total if the questions are resolved';

export function ReviewHeadline({ data, animate }: { data: Case; animate: boolean }) {
  const amount = data.scenario?.adjustments;
  const active = data.findings.filter((finding) => finding.check !== 'settlement' && finding.status === 'active');
  const sources = unique(active.flatMap((finding) => finding.evidence)).length;
  return <Animated.View entering={animate ? surfaceReveal : undefined} style={styles.reviewHeadline}>
    <View style={ui.between}>
      <View style={ui.grow}>
        <Text accessibilityRole="header" style={styles.summaryLabel}>{amount != null && amount > 0
          ? 'Worth asking billing about' : 'Case review'}</Text>
        {amount != null && amount > 0 ? <Text selectable style={[ui.money, styles.headline]}>{money(amount)}</Text>
          : <Text style={ui.heading}>Billing questions</Text>}
      </View>
      <Illustration name="balance" size={58} />
    </View>
    <View style={styles.metrics}>
      <Text style={ui.small}><Text style={styles.metricValue}>{active.length}</Text> {active.length === 1 ? 'active question' : 'active questions'}</Text>
      <Text style={ui.small}><Text style={styles.metricValue}>{sources}</Text> {sources === 1 ? 'source' : 'sources'}</Text>
    </View>
  </Animated.View>;
}

export function ScenarioCard({ data, stale, onEvidence }:
  { data: Case; stale: boolean; onEvidence: (entry: EvidenceView) => void }) {
  const scenario = data.scenario;
  if (!scenario) return null;
  const invoices = scenario.sources?.billed ?? (stale ? [] : invoiceSources(data));
  const adjustments = data.findings.filter((finding) => scenario.included.includes(finding.id));
  const adjustmentSources = scenario.sources?.adjustments ?? unique(adjustments.flatMap((finding) => finding.evidence));
  const explanation = !scenario.reconciled
    ? 'The invoice total and itemised lines need to be reconciled.'
    : 'This estimate assumes billing agrees with every question included in the calculation.';
  return <View style={styles.ledger}>
    <SectionHeader>{stale ? 'Previous calculation' : 'Bill summary'}</SectionHeader>
    <LedgerLine onEvidence={onEvidence} entry={{
      title: 'Billed', amount: scenario.billed, explanation: 'Total from the confirmed hospital invoice.', evidence: invoices,
    }} />
    <LedgerLine onEvidence={onEvidence} subtract entry={{
      title: 'Questions to ask billing', amount: scenario.adjustments, explanation: 'Billing questions included in this calculation.',
      rule: [...new Set(adjustments.map((finding) => RULES[finding.check]).filter(Boolean))].join(' · '),
      evidence: adjustmentSources,
    }} />
    <LedgerLine onEvidence={onEvidence} supportingText={explanation} entry={{
      title: conditionalTitle, amount: scenario.conditional, explanation,
      rule: 'Invoice total and supported billing adjustments',
      evidence: scenario.sources?.conditional ?? unique([...invoices, ...adjustmentSources]),
    }} />
    {scenario.unresolved_deduction !== null && scenario.unresolved_deduction > 0 &&
      <LedgerLine onEvidence={onEvidence} supportingText="Kept separate from the bill calculation." entry={{
        title: 'Insurance deduction', amount: scenario.unresolved_deduction,
        explanation: 'This deduction appears on the insurance settlement statement.',
        evidence: scenario.sources?.unresolved_deduction ?? unique(data.findings.filter((finding) =>
          finding.check === 'settlement' && finding.status === 'active').flatMap((finding) => finding.evidence)),
      }} />}
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={styles.perforation}>
      {Array.from({ length: 12 }, (_, index) => <View key={index} style={styles.perforationHole} />)}
    </View>
  </View>;
}

function revisionChange(data: Case, item: History) {
  const previous = data.history[data.history.findIndex((revision) => revision.revision === item.revision) - 1];
  const before = new Map(previous?.findings.map((finding) => [finding.id, finding]));
  const withdrawn = item.findings.filter((finding) =>
    finding.status === 'withdrawn' && before.get(finding.id)?.status === 'active');
  const oldTotal = previous?.scenario.conditional;
  const total = item.scenario.conditional;
  const movement = oldTotal == null || total == null ? null : total - oldTotal;
  const secondOrder = withdrawn.some((finding) => finding.check === 'duplicates'
    && finding.evidence.some((source) => source.document_id === 'second-order' && source.relation === 'contradicts'));
  return { previous, withdrawn, movement, secondOrder };
}

function signedMoney(amount: number) {
  return amount > 0 ? `+${money(amount)}` : money(amount);
}

export function ReviewChange({ data, onEvidence }: { data: Case; onEvidence: (entry: EvidenceView) => void }) {
  const item = data.history.at(-1);
  if (!item) return null;
  const { withdrawn, movement, secondOrder } = revisionChange(data, item);
  const [first] = withdrawn;
  const evidence = unique(withdrawn.flatMap((finding) => finding.evidence));
  if (!first) return null;
  return <View style={styles.withdrawal}>
    <View style={ui.between}>
      <Illustration name="corrected" size={36} />
      <Text style={[ui.label, ui.grow]}>{withdrawn.length} {withdrawn.length === 1 ? 'question' : 'questions'} withdrawn</Text>
      {movement !== null && movement !== 0 && <Text style={[ui.money, styles.value]}>{signedMoney(movement)}</Text>}
    </View>
    <Text style={ui.body}>{secondOrder ? 'The second lab order explains the repeat test.' : first.explanation}
      {movement !== null && movement !== 0 ? ' This changed the conditional total.' : ''}</Text>
    <SourceChips evidence={evidence} onPress={(selected) => onEvidence({
      title: 'Why the questions were withdrawn', explanation: withdrawn.map((finding) => finding.explanation).join(' '),
      amount: null, status: 'withdrawn', evidence, selected,
    })} />
  </View>;
}

export function FindingCard({ finding, onPress }: { finding: Finding; onPress: (entry: EvidenceView) => void }) {
  const withdrawn = finding.status === 'withdrawn';
  const entry: EvidenceView = { ...finding, rule: RULES[finding.check], evidence: unique(finding.evidence) };
  return <View style={[styles.finding, withdrawn && styles.withdrawnFinding]}>
    <View style={ui.row}>
      <AppIcon name={withdrawn ? 'check-circle' : finding.status === 'linked' ? 'link' : 'help-circle'} size={16} color={color.primary} />
      <Badge tone={withdrawn ? 'neutral' : finding.status === 'linked' ? 'green' : 'amber'}>
      {withdrawn ? 'Withdrawn' : finding.status === 'linked' ? 'Clause linked' : 'Ask billing'}
      </Badge>
    </View>
    <Pressable onPress={() => onPress(entry)} accessibilityRole="button"
      accessibilityLabel={`${finding.title}, ${withdrawn ? 'withdrawn' : finding.amount === null ? finding.status : money(finding.amount)}. View evidence`}
      style={[ui.between, styles.findingHeading]}>
      <Text style={[ui.label, ui.grow]}>{finding.title}</Text>
      {finding.amount !== null && <Text style={[ui.money, styles.value]}>{money(finding.amount)}</Text>}
      <AppIcon name="arrow-up-right" size={17} color={color.primary} />
    </Pressable>
    {entry.rule && <Text style={ui.small}>{entry.rule}</Text>}
    <Text style={ui.body}>{finding.explanation}</Text>
    <SourceChips evidence={entry.evidence} onPress={(selected) => onPress({ ...entry, selected })} />
  </View>;
}

export function Evidence({ entry, canOpenSource, onSource, onClose }:
  { entry: EvidenceView; canOpenSource: (source: Source) => boolean;
    onSource: (source: Source) => void; onClose: () => void }) {
  const [opened, setOpened] = useState<number | null>(entry.selected ?? 0);
  const order = entry.evidence.map((source, index) => ({ source, index }));
  const selected = entry.selected;
  if (selected !== undefined) {
    const focused = order.splice(selected, 1)[0];
    if (focused) order.unshift(focused);
  }
  return <Sheet title="Linked evidence" onClose={onClose} bottom>
    <ScrollView contentContainerStyle={ui.content}>
      <Card tone="tonal">
        <View style={ui.between}><View style={ui.grow}><SectionHeader>{entry.title}</SectionHeader></View><Illustration name="evidence" size={42} /></View>
        {entry.status === 'withdrawn' && <Badge tone="neutral">Finding withdrawn</Badge>}
        {entry.amount !== null && <Text style={[ui.money, styles.value]}>{money(entry.amount)}</Text>}
        {entry.rule && <Text style={ui.small}>Rule · {entry.rule}</Text>}
        <Text style={ui.body}>{entry.explanation}</Text>
      </Card>
      {order.length > 0 && <SectionHeader>Source records</SectionHeader>}
      {order.map(({ source, index }) => <Card key={sourceKey(source)}>
        <Badge tone={source.relation === 'contradicts' ? 'amber' : source.relation === 'supports' ? 'green' : 'neutral'}>
          {RELATION[source.relation]}
        </Badge>
        <Text style={ui.label}>{KINDS[source.document_kind]} · {source.row_id}</Text>
        <Text style={ui.small}>Page {source.page} · Line {source.line}
          {source.basis === 'patient_confirmed' ? ' · Patient-edited row' : ''}</Text>
        <Disclosure label={opened === index ? 'Hide source line' : 'View source line'} open={opened === index}
          onToggle={() => setOpened(opened === index ? null : index)}>
          <Text selectable style={styles.excerpt}>{source.quote || 'No source excerpt is available for this row.'}</Text>
          <Text selectable style={styles.hash}>Source fingerprint {source.sha256.slice(0, 12)}</Text>
          {canOpenSource(source) && <Button label="Open document at this line" icon="file-text" tone="ghost" onPress={() => onSource(source)} />}
        </Disclosure>
      </Card>)}
      {!entry.evidence.length && <EmptyState>No source excerpts are available for this finding.</EmptyState>}
    </ScrollView>
  </Sheet>;
}

export function RevisionComparison({ data, item }: { data: Case; item: History }) {
  const { previous, movement } = revisionChange(data, item);
  const oldFindings = new Map(previous?.findings.map((finding) => [finding.id, finding]));
  const changed = item.findings.filter((finding) => {
    const before = oldFindings.get(finding.id);
    return before?.status !== finding.status || before.amount !== finding.amount;
  });
  const priorSources = new Set(previous?.findings.flatMap((finding) => finding.evidence.map((source) => source.document_id)));
  const addedSources = previous ? [...new Map(item.findings.flatMap((finding) => finding.evidence)
    .filter((source) => !priorSources.has(source.document_id))
    .map((source) => [source.document_id, source])).values()] : [];
  const addedDocs = data.timeline.some((event) => previous && event.revision > previous.revision
    && event.revision <= item.revision && event.title === 'Document added');

  return <View style={ui.stack}>
    <Text style={ui.small}>Conditional total</Text>
    <View style={styles.comparison}>
      {previous && <><Text style={ui.money}>{money(previous.scenario.conditional)}</Text>
        <AppIcon name="arrow-right" size={15} color={color.muted} /></>}
      <Text style={[ui.money, styles.value]}>{money(item.scenario.conditional)}</Text>
      {movement !== null && movement !== 0 && <Text style={ui.money}>({signedMoney(movement)})</Text>}
    </View>
    {addedSources.map((source) => <Text key={source.document_id} style={ui.small}>
      Evidence linked · {source.document_id === 'second-order' ? 'Second lab order' : KINDS[source.document_kind]}
    </Text>)}
    {addedDocs && !addedSources.length && <Text style={ui.small}>Document added since the previous investigation.</Text>}
    {previous && changed.map((finding) => <Text key={finding.id} style={ui.small}>
      {finding.status === 'withdrawn' ? 'Withdrawn' : finding.status === 'linked' ? 'Clause linked' : 'Updated'} · {finding.title}
    </Text>)}
  </View>;
}

export function revisionTitle(data: Case, item: History) {
  const { previous, withdrawn, secondOrder } = revisionChange(data, item);
  if (secondOrder) return 'Second lab order reviewed';
  if (withdrawn.length) return 'Billing questions withdrawn';
  return previous ? 'Billing review updated' : 'First billing review';
}

export function Timeline({ data, onRevision }: { data: Case; onRevision: (revision: History) => void }) {
  return <>
    <SectionHeader>Case revisions</SectionHeader>
    {!data.history.length && <EmptyState>Run an investigation to record the first revision.</EmptyState>}
    <View style={ui.stack}>
      {[...data.history].reverse().map((item, index) => <View key={item.revision} style={styles.revisionRow}>
        <View style={styles.rail} importantForAccessibility="no">
          <View style={[styles.dot, index === 0 && styles.currentDot]} />
          {index < data.history.length - 1 && <View style={styles.railLine} />}
        </View>
        <Pressable accessibilityRole="button" onPress={() => onRevision(item)} style={[ui.card, ui.grow]}>
          <View style={ui.between}>
            <View style={ui.grow}><Text style={ui.label}>{revisionTitle(data, item)}</Text>
              <Text style={ui.small}>Revision {item.revision}</Text></View>
            {index === 0 && <Badge>Latest</Badge>}
            <AppIcon name="chevron-right" color={color.primary} size={17} />
          </View>
          <RevisionComparison data={data} item={item} />
        </Pressable>
      </View>)}
    </View>
    <SectionHeader>Activity</SectionHeader>
    <Card>
      {[...data.timeline].reverse().map((item, index) => <View key={item.id} style={ui.stack}>
        {index > 0 && <Divider />}
        <Text style={ui.kicker}>{item.role.toUpperCase()} · REVISION {item.revision}</Text>
        <Text style={ui.label}>{item.title}</Text>
        <Text style={ui.small}>{item.detail}</Text>
      </View>)}
    </Card>
  </>;
}

const styles = StyleSheet.create({
  revisionRow: { flexDirection: 'row', gap: 10 },
  rail: { alignItems: 'center', width: 16, paddingTop: 22 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: color.primary },
  currentDot: { backgroundColor: color.primary },
  railLine: { width: 1, flex: 1, backgroundColor: color.line, marginBottom: -10 },
  reviewHeadline: { gap: 10, padding: 16, backgroundColor: color.tertiaryContainer, borderRadius: 16 },
  summaryLabel: { ...ui.label, color: color.onTertiaryContainer },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.outline, paddingTop: 9 },
  metricValue: { ...ui.money, color: color.onTertiaryContainer },
  headline: { color: color.question, fontSize: 36, lineHeight: 44, letterSpacing: -1 },
  ledger: { gap: 4, padding: 14, paddingBottom: 0, backgroundColor: color.card, borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  ledgerSource: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', minHeight: 44, gap: 6 },
  perforation: { flexDirection: 'row', justifyContent: 'space-between' },
  perforationHole: { width: 8, height: 5, borderTopLeftRadius: 5, borderTopRightRadius: 5, backgroundColor: color.paper },
  excerpt: { ...ui.body, fontFamily: font.mono, fontSize: 13, lineHeight: 20, padding: 10,
    borderRadius: 8, backgroundColor: color.surfaceContainer },
  ledgerLine: { gap: 6, paddingVertical: 10, borderTopColor: color.line, borderTopWidth: StyleSheet.hairlineWidth },
  finding: { gap: 4, paddingTop: 10, borderTopColor: color.line, borderTopWidth: StyleSheet.hairlineWidth },
  withdrawnFinding: { backgroundColor: color.surfaceContainer, paddingHorizontal: 12, paddingBottom: 10 },
  withdrawal: { backgroundColor: color.secondaryContainer, borderRadius: 12, padding: 14, gap: 6 },
  hash: { color: color.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  value: { fontSize: 17, maxWidth: '56%', flexShrink: 1, textAlign: 'right' },
  comparison: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  findingHeading: { minHeight: 44 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 44, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderRadius: 6, borderColor: color.line },
  chipLabel: { flexShrink: 1, color: color.primary },
});
