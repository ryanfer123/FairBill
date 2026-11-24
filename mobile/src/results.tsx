import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Case, Finding, History, KINDS, Source, money } from './api';
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

function sourceLabel(source: Source) {
  return source.document_kind === 'policy'
    ? `Policy clause · p.${source.page}`
    : `${KINDS[source.document_kind]} · p.${source.page}`;
}

function SourceChips({ evidence, onPress, compact = false }:
  { evidence: Source[]; onPress: (index?: number) => void; compact?: boolean }) {
  if (compact && evidence.length > 1) return <View style={styles.chips}>
    <Pressable accessibilityRole="button" onPress={() => onPress()} style={styles.chip}>
      <Feather name="file-text" size={14} color={color.forest} />
      <Text style={[ui.small, styles.chipLabel]}>View {evidence.length} sources</Text>
    </Pressable>
  </View>;
  return <View style={styles.chips}>
    {evidence.map((source, index) => <Pressable key={sourceKey(source)} accessibilityRole="button"
      accessibilityLabel={`View ${KINDS[source.document_kind]}, page ${source.page}, line ${source.line}`}
      onPress={() => onPress(index)} style={styles.chip}>
      <Feather name="file-text" size={14} color={color.forest} />
      <Text style={[ui.small, styles.chipLabel]}>{sourceLabel(source)}</Text>
    </Pressable>)}
  </View>;
}

function LedgerLine({ entry, onEvidence }: { entry: EvidenceView; onEvidence: (entry: EvidenceView) => void }) {
  const sourced = entry.amount !== null && entry.evidence.length > 0;
  const content = <>
    <View style={ui.grow}>
      <Text style={ui.label}>{entry.title}</Text>
      {!!sourced && <Text style={ui.small}>{entry.evidence.length} {entry.evidence.length === 1 ? 'source' : 'sources'}</Text>}
    </View>
    <Text style={[ui.money, styles.value]}>{money(entry.amount)}</Text>
    {sourced && <Feather name="chevron-right" size={17} color={color.forest} />}
  </>;
  return sourced ? <Pressable accessibilityRole="button"
    accessibilityLabel={`${entry.title}, ${money(entry.amount)}. View sources`}
    onPress={() => onEvidence(entry)} style={({ pressed }) => [styles.ledgerLine, pressed && styles.ledgerPressed]}>
    {content}
  </Pressable> : <View style={styles.ledgerLine}>{content}</View>;
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

export function ScenarioCard({ data, stale, onEvidence }:
  { data: Case; stale: boolean; onEvidence: (entry: EvidenceView) => void }) {
  const scenario = data.scenario;
  if (!scenario) return null;
  const previous = data.history.at(-2);
  const invoices = scenario.sources?.billed ?? (stale ? [] : invoiceSources(data));
  const adjustments = data.findings.filter((finding) => scenario.included.includes(finding.id));
  const adjustmentSources = scenario.sources?.adjustments ?? unique(adjustments.flatMap((finding) => finding.evidence));
  const explanation = scenario.reconciled
    ? 'This total applies if the listed billing adjustments are supported.'
    : 'The invoice and its itemised lines need reconciliation.';
  const conditional: EvidenceView = {
    title: 'Conditional invoice', amount: scenario.conditional, explanation,
    rule: 'Invoice total and supported billing adjustments',
    evidence: scenario.sources?.conditional ?? unique([...invoices, ...adjustmentSources]),
  };
  return <View style={styles.ledger}>
    <View style={styles.ledgerHead}>
      <View style={ui.between}>
        <Text style={[styles.ledgerLabel, ui.grow]}>{conditional.title}</Text>
        <Feather name="file-text" size={19} color={color.mint} />
      </View>
      {stale && <View style={styles.previousTag}><Text style={styles.previousTagText}>Previous review</Text></View>}
      <Text selectable style={[ui.money, styles.headline]}>{money(conditional.amount)}</Text>
      <Text style={styles.ledgerCopy}>{explanation}</Text>
      {!!previous && previous.scenario.conditional !== scenario.conditional &&
        <Text style={styles.ledgerCopy}>Revised from <Text style={styles.previousAmount}>{money(previous.scenario.conditional)}</Text></Text>}
      {conditional.amount !== null && conditional.evidence.length > 0 && <Pressable
        accessibilityRole="button" onPress={() => onEvidence(conditional)} style={({ pressed }) =>
          [styles.ledgerSource, pressed && { opacity: 0.8 }]}>
        <Feather name="layers" size={16} color={color.mint} />
        <Text style={[styles.ledgerSourceText, ui.grow]}>
          View calculation · {conditional.evidence.length} {conditional.evidence.length === 1 ? 'source' : 'sources'}
        </Text>
        <Feather name="arrow-up-right" size={16} color={color.mint} />
      </Pressable>}
    </View>
    <View style={styles.ledgerDetails}>
    <LedgerLine onEvidence={onEvidence} entry={{
      title: 'Original invoice', amount: scenario.billed, explanation: 'Total from the confirmed hospital invoice.', evidence: invoices,
    }} />
    <View style={ui.divider} />
    <LedgerLine onEvidence={onEvidence} entry={{
      title: 'Conditional adjustments', amount: scenario.adjustments, explanation: 'Billing questions included in this calculation.',
      rule: [...new Set(adjustments.map((finding) => RULES[finding.check]).filter(Boolean))].join(' · '),
      evidence: adjustmentSources,
    }} />
    {scenario.unresolved_deduction !== null && scenario.unresolved_deduction > 0 && <>
      <View style={ui.divider} />
      <LedgerLine onEvidence={onEvidence} entry={{
        title: 'Separate insurance deduction', amount: scenario.unresolved_deduction,
        explanation: 'This deduction is reported separately from the conditional invoice.',
        evidence: scenario.sources?.unresolved_deduction ?? unique(data.findings.filter((finding) =>
          finding.check === 'settlement' && finding.status === 'active').flatMap((finding) => finding.evidence)),
      }} />
    </>}
    </View>
  </View>;
}

export function FindingCard({ finding, onPress }: { finding: Finding; onPress: (entry: EvidenceView) => void }) {
  const withdrawn = finding.status === 'withdrawn';
  const entry: EvidenceView = { ...finding, rule: RULES[finding.check], evidence: unique(finding.evidence) };
  return <Card>
    <View style={ui.row}>
      <Feather name={withdrawn ? 'check-circle' : finding.status === 'linked' ? 'link' : 'help-circle'} size={16} color={color.forest} />
      <Badge tone={withdrawn ? 'neutral' : finding.status === 'linked' ? 'green' : 'amber'}>
      {withdrawn ? 'Withdrawn' : finding.status === 'linked' ? 'Clause linked' : 'Ask billing'}
      </Badge>
    </View>
    <Pressable onPress={() => onPress(entry)} accessibilityRole="button"
      accessibilityLabel={`${finding.title}, ${withdrawn ? 'withdrawn' : finding.amount === null ? finding.status : money(finding.amount)}. View evidence`}
      style={[ui.between, styles.findingHeading]}>
      <Text style={[ui.label, ui.grow]}>{finding.title}</Text>
      {finding.amount !== null && <Text style={[ui.money, styles.value]}>{money(finding.amount)}</Text>}
      <Feather name="arrow-up-right" size={17} color={color.forest} />
    </Pressable>
    <Text style={ui.body}>{finding.explanation}</Text>
    <SourceChips evidence={entry.evidence} compact onPress={(selected) => onPress({ ...entry, selected })} />
  </Card>;
}

export function Evidence({ entry, onClose }: { entry: EvidenceView; onClose: () => void }) {
  const [opened, setOpened] = useState<number | null>(entry.selected ?? null);
  const order = entry.evidence.map((source, index) => ({ source, index }));
  const selected = entry.selected;
  if (selected !== undefined) {
    const focused = order.splice(selected, 1)[0];
    if (focused) order.unshift(focused);
  }
  return <Sheet title="Linked evidence" onClose={onClose} bottom>
    <ScrollView contentContainerStyle={ui.content}>
      <Card tone="tonal">
        {entry.status === 'withdrawn' && <Badge tone="neutral">Finding withdrawn</Badge>}
        <SectionHeader>{entry.title}</SectionHeader>
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
        <Button label={opened === index ? 'Hide source line' : 'View source line'} icon="file-text" tone="ghost"
          onPress={() => setOpened(opened === index ? null : index)} />
        {opened === index && <>
          <View style={styles.sourceQuote}>
            <Text selectable style={ui.body}>{source.quote || 'No source excerpt is available for this row.'}</Text>
          </View>
          <Text selectable style={styles.hash}>Source fingerprint {source.sha256.slice(0, 12)}</Text>
        </>}
      </Card>)}
      {!entry.evidence.length && <EmptyState>No source excerpts are available for this finding.</EmptyState>}
    </ScrollView>
  </Sheet>;
}

export function RevisionComparison({ data, item }: { data: Case; item: History }) {
  const previous = data.history[data.history.findIndex((revision) => revision.revision === item.revision) - 1];
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
    <Text style={ui.small}>Conditional invoice</Text>
    <View style={styles.comparison}>
      {previous && <><Text style={ui.money}>{money(previous.scenario.conditional)}</Text>
        <Feather name="arrow-right" size={15} color={color.muted} /></>}
      <Text style={[ui.money, styles.value]}>{money(item.scenario.conditional)}</Text>
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
            <Text style={[ui.label, ui.grow]}>Revision {item.revision}</Text>
            {index === 0 && <Badge>Latest</Badge>}
            <Feather name="chevron-right" color={color.forest} size={17} />
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
  sourceQuote: { backgroundColor: color.panel, borderRadius: 12, padding: 14 },
  revisionRow: { flexDirection: 'row', gap: 10 },
  rail: { alignItems: 'center', width: 16, paddingTop: 22 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: color.forest },
  currentDot: { backgroundColor: color.forest },
  railLine: { width: 1, flex: 1, backgroundColor: color.line, marginBottom: -10 },
  ledger: { borderRadius: 22, borderWidth: 1, borderColor: color.line, overflow: 'hidden', backgroundColor: color.card },
  ledgerHead: { backgroundColor: color.forest, padding: 18, gap: 8 },
  ledgerLabel: { color: color.lime, fontWeight: '600', fontSize: 16 },
  headline: { color: color.lime, fontSize: 41, letterSpacing: -1.2 },
  ledgerCopy: { color: color.mint, fontSize: 14, lineHeight: 20 },
  previousAmount: { fontVariant: ['tabular-nums'], color: color.lime, fontWeight: '700' },
  previousTag: { alignSelf: 'flex-start', backgroundColor: color.sand, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8 },
  previousTagText: { color: color.amber, fontSize: 12, fontWeight: '600' },
  ledgerSource: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44,
    marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.mint },
  ledgerSourceText: { color: color.lime, fontSize: 14, fontWeight: '600' },
  ledgerDetails: { paddingHorizontal: 16, paddingVertical: 4 },
  ledgerLine: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 55, paddingVertical: 9 },
  ledgerPressed: { opacity: 0.65 },
  hash: { color: color.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  value: { fontSize: 17, maxWidth: '56%', flexShrink: 1 },
  comparison: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  findingHeading: { minHeight: 44 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 44, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderRadius: 6, borderColor: color.line },
  chipLabel: { flexShrink: 1, color: color.forest },
});
