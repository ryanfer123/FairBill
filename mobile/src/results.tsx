import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Case, Finding, History, KINDS, Source, money } from './api';
import { Badge, Button, Sheet, color, ui } from './ui';

const RELATION: Record<Source['relation'], string> = {
  supports: 'Supports the question', contradicts: 'Challenges the question',
  context: 'Related evidence', patient_report: 'Patient report',
};

export function ScenarioCard({ data, stale }: { data: Case; stale: boolean }) {
  const scenario = data.scenario;
  if (!scenario) return null;
  const previous = data.history.at(-2);
  return <View style={styles.hero}>
    <View style={ui.between}>
      <Text style={[styles.heroKicker, ui.grow]}>CONDITIONAL INVOICE</Text>
      {stale && <Badge tone="amber">Previous revision</Badge>}
      {!stale && <Badge>{data.agent_mode === 'Gemini' ? 'Gemini planner' : 'Offline planner'}</Badge>}
    </View>
    <Text style={styles.heroAmount}>{money(scenario.conditional)}</Text>
    <Text style={styles.heroBody}>{scenario.reconciled
      ? 'If the active billing adjustments are supported.'
      : 'The invoice and its itemised lines need reconciliation.'}</Text>
    {!!previous && previous.scenario.conditional !== scenario.conditional && <View style={styles.revision}>
      <Feather name="repeat" size={15} color={color.lime} />
      <Text style={[styles.heroBody, ui.grow]}>Revised from {money(previous.scenario.conditional)}</Text>
    </View>}
    <View style={styles.heroDivider} />
    <View style={ui.between}>
      <Text style={[styles.heroBody, ui.grow]}>Original invoice</Text>
      <Text style={styles.heroValue}>{money(scenario.billed)}</Text>
    </View>
    <View style={ui.between}>
      <Text style={[styles.heroBody, ui.grow]}>Conditional adjustments</Text>
      <Text style={styles.heroValue}>{money(scenario.adjustments)}</Text>
    </View>
  </View>;
}

export function FindingCard({ finding, onPress }: { finding: Finding; onPress: () => void }) {
  const withdrawn = finding.status === 'withdrawn';
  return <Pressable onPress={onPress} accessibilityRole="button"
    accessibilityLabel={`${finding.title}, ${withdrawn ? 'withdrawn' : finding.amount === null ? finding.status : money(finding.amount)}. View evidence`}
    style={({ pressed }) => [ui.card, pressed && { opacity: 0.78 }]}>
    <View style={ui.between}>
      <Badge tone={withdrawn ? 'neutral' : finding.check === 'settlement' ? 'amber' : 'green'}>
        {withdrawn ? 'Withdrawn' : finding.status === 'linked' ? 'Clause linked' : 'Review'}
      </Badge>
      <Text style={styles.findingAmount}>{finding.amount === null ? '' : money(finding.amount)}</Text>
    </View>
    <View style={ui.between}>
      <Text style={[ui.label, ui.grow]}>{finding.title}</Text>
      <Feather name="arrow-up-right" size={18} color={color.forest} />
    </View>
    <Text style={ui.small}>{finding.explanation}</Text>
    <Text style={ui.kicker}>{finding.evidence.length} {finding.evidence.length === 1 ? 'SOURCE' : 'SOURCES'}</Text>
  </Pressable>;
}

export function Evidence({ finding, onClose }: { finding: Finding; onClose: () => void }) {
  const [opened, setOpened] = useState<number | null>(null);
  return <Sheet title="Linked evidence" onClose={onClose}>
    <ScrollView contentContainerStyle={ui.content}>
      <View style={ui.card}>
        <Badge tone={finding.status === 'withdrawn' ? 'neutral' : 'green'}>
          {finding.status === 'withdrawn' ? 'Finding withdrawn' : 'Evidence review'}
        </Badge>
        <Text style={ui.heading}>{finding.title}</Text>
        <Text style={ui.body}>{finding.explanation}</Text>
        {finding.amount !== null && <Text style={styles.findingAmount}>{money(finding.amount)}</Text>}
      </View>
      {finding.evidence.map((source, index) => (
        <View key={`${source.document_id}:${source.row_id}:${index}`} style={styles.node}>
          <View style={styles.nodeRail}>
            <View style={[styles.nodeDot, source.relation === 'contradicts' && { backgroundColor: color.amber }]} />
            <View style={styles.nodeLine} />
          </View>
          <View style={[ui.card, ui.grow]}>
            <Badge tone={source.relation === 'contradicts' ? 'amber' : 'green'}>{RELATION[source.relation]}</Badge>
            <Text style={ui.label}>{KINDS[source.document_kind]} · {source.row_id}</Text>
            <Text style={ui.small}>Page {source.page} · Line {source.line}
              {source.basis === 'patient_confirmed' ? ' · Patient-edited row' : ''}</Text>
            <Button label={opened === index ? 'Hide source line' : 'View source line'} icon="file-text" tone="ghost"
              onPress={() => setOpened(opened === index ? null : index)} />
            {opened === index && <>
              <Text selectable style={ui.small}>{source.quote || 'This row was entered during patient review.'}</Text>
              <Text selectable style={ui.kicker}>DOCUMENT HASH {source.sha256.slice(0, 12)}</Text>
            </>}
          </View>
        </View>
      ))}
    </ScrollView>
  </Sheet>;
}

export function Timeline({ data, onRevision }: { data: Case; onRevision: (revision: History) => void }) {
  return <>
    {data.history.length > 0 && <>
      <Text style={ui.heading}>Case revisions</Text>
      {[...data.history].reverse().map((item) => <Pressable key={item.revision} accessibilityRole="button"
        onPress={() => onRevision(item)} style={[ui.card, ui.between]}>
        <View style={ui.grow}>
          <Text style={ui.label}>Revision {item.revision}</Text>
          <Text style={ui.small}>Conditional invoice · {money(item.scenario.conditional)}</Text>
        </View>
        <Feather name="arrow-up-right" color={color.ink} size={18} />
      </Pressable>)}
    </>}
    <Text style={ui.heading}>Activity</Text>
    {[...data.timeline].reverse().map((item) => <View key={item.id} style={ui.card}>
      <Text style={ui.kicker}>{item.role.toUpperCase()} · REVISION {item.revision}</Text>
      <Text style={ui.label}>{item.title}</Text>
      <Text style={ui.small}>{item.detail}</Text>
    </View>)}
  </>;
}

const styles = StyleSheet.create({
  hero: { borderRadius: 24, padding: 18, backgroundColor: color.forest, gap: 9 },
  heroKicker: { color: color.mint, fontSize: 11, letterSpacing: 1.45, fontWeight: '800' },
  heroAmount: { color: color.lime, fontSize: 42, letterSpacing: -1.5, fontWeight: '800' },
  heroBody: { color: '#CDDFD2', fontSize: 13, lineHeight: 19 },
  heroValue: { color: '#F9FCF1', fontSize: 15, fontWeight: '800' },
  heroDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#789487', marginVertical: 2 },
  revision: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 8, borderRadius: 10, backgroundColor: '#254D3D' },
  findingAmount: { color: color.forest, fontWeight: '800', fontSize: 18 },
  node: { flexDirection: 'row', gap: 10 },
  nodeRail: { alignItems: 'center', width: 14, paddingTop: 15 },
  nodeDot: { width: 11, height: 11, borderRadius: 9, backgroundColor: color.forest },
  nodeLine: { flex: 1, width: 2, backgroundColor: color.line },
});
