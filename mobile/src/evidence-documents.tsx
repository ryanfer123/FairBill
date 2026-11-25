import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Chip } from 'react-native-paper';
import { AppIcon } from './icons';
import { Illustration } from './illustrations';
import { KINDS, money, type Case } from './api';
import { Badge, Button, EmptyState, color, ui } from './ui';

const previewLimit = 8;

export function EvidenceDocuments({ data, busy, onOpen }:
  { data: Case; busy: boolean; onOpen: (id: string, rowId?: string) => void }) {
  const [selected, setSelected] = useState<string>();
  const document = data.documents.find((item) => item.id === selected) ?? data.documents[0];
  if (!document) return <EmptyState>No documents in this case yet.</EmptyState>;

  const current = data.revision === data.investigated_revision;
  const citedRows = new Set(current ? data.findings.filter((finding) => finding.status === 'active')
    .flatMap((finding) => finding.evidence.filter((item) => item.document_id === document.id).map((item) => item.row_id)) : []);
  const corrected = current && data.findings.some((finding) => finding.status === 'withdrawn'
    && finding.evidence.some((item) => item.document_id === document.id && item.relation === 'contradicts'));
  const total = document.rows.filter((row) => row.type === 'invoice_total');
  const title = (item: Case['documents'][number]) => item.id === 'second-order' ? 'Second lab order' : KINDS[item.kind];

  return <>
    <View style={ui.stack}>
      <Text style={ui.body}>{data.documents.length} {data.documents.length === 1 ? 'document' : 'documents'} · {data.documents.filter((item) => item.confirmed).length} confirmed</Text>
      <View style={styles.chips}>
        {data.documents.map((item) => {
          const duplicate = data.documents.filter((candidate) => title(candidate) === title(item));
          const label = duplicate.length > 1 ? `${title(item)} ${duplicate.indexOf(item) + 1}` : title(item);
          return <Chip key={item.id} style={styles.selector} selected={item.id === document.id}
            accessibilityState={{ selected: item.id === document.id, disabled: busy }} disabled={busy}
            onPress={() => setSelected(item.id)}>{label}</Chip>;
        })}
      </View>
    </View>
    <View style={styles.paper}>
      <View style={ui.between}>
        <Illustration name="evidence" size={44} />
        <View style={ui.grow}>
          <Text accessibilityRole="header" style={ui.heading}>{title(document)}</Text>
          <Text style={ui.small}>{document.pages.length} {document.pages.length === 1 ? 'page' : 'pages'} · {document.rows.length} {document.rows.length === 1 ? 'line' : 'lines'}</Text>
        </View>
        {!document.confirmed && <Badge tone="amber">Needs review</Badge>}
      </View>
      {corrected && <Text style={styles.corrected}>Explains the repeat charge</Text>}
      {document.confirmed && total.length === 1 && total[0]?.amount != null && <Text selectable style={[ui.money, styles.total]}>{money(total[0].amount)}</Text>}
      {document.rows.slice(0, previewLimit).map((row) => {
        const cited = citedRows.has(row.id);
        return <Pressable accessibilityRole="button" accessibilityHint="Opens the document at this source line"
          key={row.id} disabled={busy} onPress={() => onOpen(document.id, row.id)}
          style={({ pressed }) => [ui.between, styles.line, cited && styles.cited, pressed && styles.pressed]}>
          <View style={ui.grow}>
            <Text style={ui.label}>{row.description}</Text>
            <Text style={ui.small}>Page {row.page} · Line {row.line}{cited ? ' · Cited' : ''}</Text>
          </View>
          {row.amount != null && <Text style={[ui.money, styles.amount]}>{money(row.amount)}</Text>}
          <AppIcon name="chevron-right" size={16} color={color.primary} />
        </Pressable>;
      })}
      {document.rows.length > previewLimit && <Text style={ui.small}>Showing {previewLimit} of {document.rows.length} lines.</Text>}
      <Button label={document.confirmed ? 'Open full document' : 'Confirm document lines'} icon="file-text" tone="ghost"
        disabled={busy} onPress={() => onOpen(document.id)} />
    </View>
  </>;
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  selector: { minHeight: 44 },
  paper: { backgroundColor: color.card, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line, padding: 12, gap: 6 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, minHeight: 48, padding: 8 },
  cited: { backgroundColor: color.tertiaryContainer, borderRadius: 8 },
  pressed: { opacity: 0.75 },
  amount: { flexShrink: 1, maxWidth: '46%', textAlign: 'right' },
  total: { alignSelf: 'flex-end', fontSize: 19, marginVertical: 4 },
  corrected: { ...ui.small, color: color.primary },
});
