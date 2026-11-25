import { Illustration } from './illustrations';
import { AppIcon } from './icons';
import { cloudBuild } from './cloud-auth';
import { pickDocument, type CaptureMethod, type PickedDocument } from './document-picker';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Document, Kind, KINDS, money, parseRupees, Row, RowType } from './api';
import { CaptureOptions } from './capture-options';
import { Disclosure } from './disclosure';
import { ActionBar, Badge, Button, Card, Divider, EmptyState, IconButton, Input, LoadingState, Message, SectionHeader, Sheet, color, ui } from './ui';

export function Intake({ busy, startKind, onClose, onPaste, onFile }:
  { busy: boolean; startKind: Kind; onClose: () => void; onPaste: (kind: Kind, text: string) => Promise<void>;
    onFile: (kind: Kind, asset: PickedDocument) => Promise<void> }) {
  const [kind, setKind] = useState<Kind>(startKind);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [picking, setPicking] = useState<CaptureMethod | null>(null);
  const disabled = picking !== null || busy;

  async function pick(method: CaptureMethod) {
    setError('');
    setPicking(method);
    try {
      const asset = await pickDocument(method);
      if (asset) await onFile(kind, asset);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPicking(null);
    }
  }

  async function paste() {
    setError('');
    try {
      await onPaste(kind, body);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return <Sheet title="Add evidence" onClose={() => { if (!disabled) onClose(); }}>
    <KeyboardAvoidingView style={ui.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
        <View style={ui.stack}>
          <Text style={ui.title}>Add a document</Text>
          <Text style={ui.body}>{cloudBuild ? 'Choose the document type, then scan or import it for review.'
            : 'Choose the type first, then scan or import a synthetic document for review.'}</Text>
        </View>
        {error ? <Message text={error} /> : null}
        <Card>
          <SectionHeader>Document type</SectionHeader>
          {(Object.keys(KINDS) as Kind[]).map((value) => (
            <Pressable key={value} accessibilityRole="radio" accessibilityLabel={KINDS[value]} accessibilityState={{ checked: value === kind, disabled }}
              disabled={disabled} onPress={() => setKind(value)}
              style={[ui.row, styles.option, value === kind && styles.selected]}>
              <AppIcon name={value === kind ? 'check-circle' : 'circle'} size={18} color={color.primary} />
              <Text style={ui.label}>{KINDS[value]}</Text>
            </Pressable>
          ))}
        </Card>
        <CaptureOptions pending={picking ?? undefined} disabled={disabled} onChoose={(method) => void pick(method)} />
        <Card>
          <SectionHeader>Paste document text</SectionHeader>
          <Input value={body} onChangeText={setBody} label="Document text"
            accessibilityLabel="Document text" style={{ minHeight: 110 }}
            multiline maxLength={20000} editable={!disabled} />
          <Button label="Review pasted text" icon="arrow-right" tone="ghost" disabled={disabled || !body.trim()} onPress={() => void paste()} />
        </Card>
        {busy && <LoadingState label="Reading document…" />}
      </ScrollView>
    </KeyboardAvoidingView>
  </Sheet>;
}

const ROWS: Record<Kind, RowType[]> = {
  invoice: ['charge', 'invoice_total'],
  policy: ['clause'],
  settlement: ['deduction'],
  service_record: ['order', 'quantity'],
};
const ROW_LABEL: Record<RowType, string> = {
  charge: 'Charge', invoice_total: 'Invoice total', deduction: 'Deduction',
  clause: 'Policy clause', order: 'Service order', quantity: 'Documented quantity',
};
type EditFields = { description: string; page: string; line: string; code: string; service_date: string;
  reference: string; units: string; amount: string; unit_price: string };

function inputAmount(amount: number | null) {
  return amount === null ? '' : money(amount).replace(/[₹,]/g, '');
}

function number(value: string, label: string, allowEmpty = false) {
  if (allowEmpty && !value.trim()) return null;
  if (!/^\d{1,4}$/.test(value) || Number(value) < 1) throw new Error(`Enter a valid ${label}.`);
  return Number(value);
}

function editable(row: Row): EditFields {
  return {
    description: row.description, page: String(row.page), line: String(row.line),
    code: row.code, service_date: row.service_date, reference: row.reference,
    units: row.units === null ? '' : String(row.units),
    amount: inputAmount(row.amount), unit_price: inputAmount(row.unit_price),
  };
}

export function Review({ doc, busy, onClose, onConfirm, onDiscard, initialRowId, readOnly = false }:
  { doc: Document; busy: boolean; onClose: () => void; onConfirm: (rows: Row[]) => Promise<void>;
    onDiscard: () => Promise<void>; initialRowId?: string; readOnly?: boolean }) {
  const [rows, setRows] = useState(doc.rows);
  const [source, setSource] = useState(false);
  const [openLine, setOpenLine] = useState<string | null>(initialRowId ?? null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [fields, setFields] = useState<EditFields | null>(null);
  const [error, setError] = useState('');

  function edit(row: Row) {
    setEditing(row);
    setFields(editable(row));
    setError('');
  }

  function add(type: RowType) {
    let index = rows.length + 1;
    while (rows.some((row) => row.id === `manual-${index}`)) index += 1;
    edit({
      id: `manual-${index}`, type, page: 1, line: 1, description: '', code: '', service_date: '', reference: '',
      units: null, amount: null, unit_price: null, received: null,
    });
  }

  function saveRow() {
    if (!fields || !editing) return;
    try {
      if (!fields.description.trim()) throw new Error('Enter a description.');
      const page = number(fields.page, 'page')!;
      const line = number(fields.line, 'line')!;
      const lines = (doc.pages[page - 1] ?? '').split('\n');
      if (page > doc.pages.length || line > lines.length) throw new Error('Choose a page and line from the extracted text.');
      const row: Row = {
        ...editing, description: fields.description.trim(), page, line,
        code: fields.code.trim(), service_date: fields.service_date.trim(), reference: fields.reference.trim(),
        units: number(fields.units, 'quantity', true), amount: parseRupees(fields.amount),
        unit_price: parseRupees(fields.unit_price),
      };
      setRows((current) => current.some((item) => item.id === row.id)
        ? current.map((item) => item.id === row.id ? row : item)
        : [...current, row]);
      setEditing(null);
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function confirm() {
    setError('');
    try { await onConfirm(rows); } catch (cause) { setError((cause as Error).message); }
  }

  async function discard() {
    setError('');
    try { await onDiscard(); } catch (cause) { setError((cause as Error).message); }
  }

  const changed = JSON.stringify(rows) !== JSON.stringify(doc.rows);
  const editingExisting = rows.some((row) => row.id === editing?.id);

  function cancelEdit() {
    setEditing(null);
    setError('');
  }

  function close() {
    if (busy) return;
    if (changed || (editing && JSON.stringify(fields) !== JSON.stringify(editable(editing)))) {
      Alert.alert('Leave without saving?', 'Your unconfirmed changes will be discarded.', [
        { text: 'Keep reviewing', style: 'cancel' }, { text: 'Discard changes', style: 'destructive', onPress: onClose },
      ]);
    } else onClose();
  }

  const editor = editing && fields ? <View style={ui.stack}>
    <Divider />
          {([
            ['description', 'Description', 'default'], ['page', 'Source page', 'number-pad'],
            ['line', 'Source line', 'number-pad'],
            ...(['charge', 'order', 'quantity'].includes(editing.type)
              ? [['code', 'Service code', 'default'], ['service_date', 'Service date (YYYY-MM-DD)', 'default'],
                ['units', 'Quantity', 'number-pad']] : []),
            ...(['charge', 'invoice_total', 'deduction'].includes(editing.type) ? [['amount', 'Line amount in rupees', 'decimal-pad']] : []),
            ...(editing.type === 'charge' ? [['unit_price', 'Unit price in rupees', 'decimal-pad']] : []),
            ...(['charge', 'deduction', 'clause', 'order', 'quantity'].includes(editing.type)
              ? [['reference', editing.type === 'clause' || editing.type === 'deduction' ? 'Policy clause ID' : 'Service record ID', 'default']] : []),
          ] as [keyof EditFields, string, 'default' | 'number-pad' | 'decimal-pad'][]).map(([key, label, keyboardType]) => (
            <View key={key} style={{ gap: 5 }}>
              <Input label={label} accessibilityLabel={label} value={fields[key]} keyboardType={keyboardType}
                maxLength={key === 'description' ? 250 : 80}
                onChangeText={(value) => setFields((current) => current && { ...current, [key]: value })} />
            </View>
          ))}
          {error ? <Message text={error} /> : null}
          <Button label="Save row" icon="check" onPress={saveRow} />
          {rows.some((row) => row.id === editing.id) && <Button label="Remove row" icon="trash-2" tone="destructive"
            onPress={() => { setRows((current) => current.filter((row) => row.id !== editing.id)); setEditing(null); setError(''); }} />}
    <Button label="Cancel row edit" tone="ghost" onPress={cancelEdit} />
  </View> : null;

  const selectedRow = rows.find((row) => row.id === initialRowId);

  return <Sheet title={doc.id === 'second-order' ? 'Second lab order' : KINDS[doc.kind]} onClose={close}>
    <KeyboardAvoidingView style={ui.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
          <View style={ui.stack}>
            <Text accessibilityRole="header" style={ui.title}>{doc.confirmed ? 'Document lines' : 'Confirm document lines'}</Text>
            <Text style={ui.body}>{readOnly ? 'Compare the supplied rows with the document.' : 'Open a source line to see the extracted text, then correct anything that was misread.'}</Text>
          </View>
          <View style={styles.readSummary}>
            <Illustration name="confirm" size={40} />
            <View style={ui.grow}>
              <Text style={ui.label}>{rows.length} {rows.length === 1 ? 'document line' : 'document lines'}</Text>
              <Text style={ui.small}>{doc.pages.length} {doc.pages.length === 1 ? 'source page' : 'source pages'}</Text>
            </View>
            <Badge tone={changed || editing ? 'amber' : 'neutral'}>{changed || editing ? 'Unsaved' : doc.confirmed ? 'Confirmed' : 'Pending'}</Badge>
          </View>
          <Button label={source ? 'Hide extracted text' : 'Show extracted text'} icon="file-text" tone="ghost"
            onPress={() => setSource(!source)} />
          {source && doc.pages.map((page, index) => <View key={index} style={ui.card}>
            <Text style={ui.kicker}>PAGE {index + 1}</Text>
            <Text selectable style={ui.small}>{page.split('\n').map((line, i) => `${i + 1}  ${line}`).join('\n') || 'No text found'}</Text>
          </View>)}
          {doc.notes.length > 0 && <View style={styles.extractionNotice}>
            <AppIcon name="alert-circle" size={18} color={color.onTertiaryContainer} />
            <View style={[ui.grow, ui.stack]}>
              <Text style={ui.label}>Check the extraction</Text>
              {doc.notes.slice(0, source ? undefined : 4).map((note, index) => <Text key={index} style={ui.small}>{note}</Text>)}
              {!source && doc.notes.length > 4 && <Text style={ui.small}>Show extracted text to read the remaining notes.</Text>}
            </View>
          </View>}
          {!rows.length && !editing && <EmptyState>No rows were extracted. Add a row using the source text.</EmptyState>}
          {selectedRow && <View style={[ui.stack, styles.highlight]}>
            <Text style={ui.label}>Linked source · Page {selectedRow.page}, line {selectedRow.line}</Text>
            <Text selectable style={ui.body}>{doc.pages[selectedRow.page - 1]?.split(/\r?\n/)[selectedRow.line - 1]
              || 'No extracted text at this position.'}</Text>
          </View>}
          {rows.length > 0 && <View style={ui.card}>
          {rows.map((row, index) => <View key={row.id} style={ui.stack}>
            {index > 0 && <Divider />}
            <View style={ui.between}>
              <View style={ui.grow}>
                <Text style={ui.kicker}>{ROW_LABEL[row.type]}</Text>
                <Text style={ui.label}>{row.description}</Text>
              </View>
              {row.amount !== null && <Text style={ui.money}>{money(row.amount)}</Text>}
              {!readOnly && !editing && !busy && <IconButton label={`Edit ${row.description}`} icon="edit-2" onPress={() => edit(row)} />}
            </View>
            {row.units !== null && <Text style={ui.small}>{row.units} {row.units === 1 ? 'unit' : 'units'}</Text>}
            {doc.notes.some((note) => note.startsWith(`Page ${row.page}, line ${row.line} `)) &&
              <Text style={ui.small}>Extraction needs review</Text>}
            {!readOnly && row.type === 'charge' && <Pressable accessibilityRole="checkbox" accessibilityLabel="I did not receive this service" disabled={!!editing || busy}
              accessibilityState={{ checked: row.received === false, disabled: !!editing || busy }}
              onPress={() => setRows((current) => current.map((item) => item.id === row.id
                ? { ...item, received: item.received === false ? null : false } : item))}
              style={[ui.row, { minHeight: 44 }]}>
              <AppIcon name={row.received === false ? 'check-square' : 'square'} size={17} color={color.ink} />
              <Text style={ui.small}>I did not receive this service</Text>
            </Pressable>}
            {!!row.reference && <Badge>{row.reference}</Badge>}
            <Disclosure label={`Page ${row.page}, line ${row.line}`}
              accessibilityLabel={`Source for ${row.description}, page ${row.page}, line ${row.line}`}
              open={openLine === row.id} onToggle={() => setOpenLine(openLine === row.id ? null : row.id)}>
              <Text style={ui.kicker}>Extracted text</Text>
              <Text selectable style={ui.body}>{doc.pages[row.page - 1]?.split(/\r?\n/)[row.line - 1]?.trim()
                || 'No extracted text at this position.'}</Text>
            </Disclosure>
            {editing?.id === row.id && editor}
          </View>)}
          </View>}
          {editing && !editingExisting && <View style={ui.card}>{editor}</View>}
          {!readOnly && ROWS[doc.kind].map((type) => <Button key={type} label={`Add ${ROW_LABEL[type].toLowerCase()}`} icon="plus"
            tone="ghost" disabled={busy || !!editing} onPress={() => add(type)} />)}
          {error && !editing ? <Message text={error} /> : null}
          {!readOnly && !doc.confirmed && <Button label="Discard unconfirmed import" icon="trash-2" tone="destructive"
            disabled={busy || !!editing} onPress={() => void discard()} />}
      </ScrollView>
      {!editing && (!readOnly || !doc.confirmed) && <ActionBar>
          <Button label={`Confirm ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`} icon="check"
            disabled={!rows.length || !!editing} busy={busy} onPress={() => void confirm()} />
      </ActionBar>}
    </KeyboardAvoidingView>
  </Sheet>;
}

const styles = StyleSheet.create({
  readSummary: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: color.secondaryContainer, borderRadius: 16, padding: 12 },
  highlight: { padding: 12, backgroundColor: color.tertiaryContainer, borderRadius: 8 },
  extractionNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: color.tertiaryContainer, borderRadius: 12, padding: 12 },
  option: { minHeight: 48, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12 },
  selected: { backgroundColor: color.secondaryContainer },
});
