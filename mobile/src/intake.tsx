import { useFairBillTheme, themedStyles } from './theme';
import { Illustration } from './illustrations';
import { AppIcon } from './icons';
import { cloudBuild } from './cloud-auth';
import { pickDocument, type CaptureMethod, type PickedDocument } from './document-picker';
import { useRef, useState } from 'react';
import { Alert, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Document, Kind, KINDS, money, newImportId, parseRupees, Row, RowType } from './api';
import { ScanPreview, type ScanStage } from './scan-preview';
import { CaptureOptions } from './capture-options';
import Animated from 'react-native-reanimated';
import { evidenceReveal } from './motion';
import { font } from './typography';
import { Disclosure } from './disclosure';
import { ActionBar, Badge, Button, Card, CurrencyText, Divider, IconButton, Input, LoadingState, Message, SectionHeader, Sheet } from './ui';

export function Intake({ busy, startKind, onClose, onPaste, onFile, discarding, onDiscard }:
  { busy: boolean; discarding: boolean; onDiscard: () => void; startKind: Kind; onClose: () => void; onPaste: (kind: Kind, text: string) => Promise<void>;
    onFile: (kind: Kind, asset: PickedDocument, onStage: (stage: ScanStage) => void, importId: string) => Promise<void> }) {
  const { ui, color } = useFairBillTheme();
  const styles = useStyles();
  const [kind, setKind] = useState<Kind>(startKind);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [picking, setPicking] = useState<CaptureMethod | null>(null);
  const [scanning, setScanning] = useState<PickedDocument | null>(null);
  const [failedFile, setFailedFile] = useState<{ method: CaptureMethod; asset: PickedDocument; message: string; importId: string }>();
  const [manualEntry, setManualEntry] = useState(false);
  const [stage, setStage] = useState<ScanStage>('preparing');
  const disabled = picking !== null || busy;

  async function pick(method: CaptureMethod, selected?: PickedDocument, importId = newImportId()) {
    setError('');
    setPicking(method);
    let asset = selected;
    try {
      asset ??= await pickDocument(method);
      if (asset) {
        setFailedFile(undefined);
        setStage('preparing');
        setScanning(asset);
        await onFile(kind, asset, setStage, importId);
      }
    } catch (cause) {
      const message = (cause as Error).message;
      if (asset) setFailedFile({ method, asset, message, importId });
      else setError(message);
    } finally {
      setScanning(null);
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
    {scanning ? <ScanPreview asset={scanning} stage={stage} onDiscard={onDiscard} discarding={discarding} />
      : failedFile ? <ScanPreview asset={failedFile.asset} stage={stage} discarding={false} onDiscard={onDiscard}
        recovery={{ message: failedFile.message, replaceLabel: failedFile.method === 'camera' ? 'Retake photo' : 'Choose another file',
          onRetry: () => void pick(failedFile.method, failedFile.asset, failedFile.importId),
          onReplace: () => void pick(failedFile.method),
          onPaste: () => { setManualEntry(true); setFailedFile(undefined); } }} />
      : <KeyboardAvoidingView style={ui.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
            accessibilityLabel="Document text" autoFocus={manualEntry} style={{ minHeight: 110 }}
            multiline maxLength={20000} editable={!disabled} />
          <Button label="Review pasted text" icon="arrow-right" tone="ghost" disabled={disabled || !body.trim()} onPress={() => void paste()} />
        </Card>
        {busy && <><LoadingState label={discarding ? 'Finishing discard…' : 'Reading document…'} /><Button label="Discard import" tone="ghost" disabled={discarding} onPress={onDiscard} /></>}
      </ScrollView>
    </KeyboardAvoidingView>}
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

export function Review({ doc, busy, onClose, onConfirm, onDiscard, onReplace, original, initialRowId, readOnly = false }:
  { doc: Document; busy: boolean; onClose: () => void; onConfirm: (rows: Row[]) => Promise<void>;
    onDiscard: () => Promise<void>; onReplace: () => Promise<void>; original?: PickedDocument; initialRowId?: string; readOnly?: boolean }) {
  const { ui, color } = useFairBillTheme();
  const styles = useStyles();
  const [rows, setRows] = useState(doc.rows);
  const [source, setSource] = useState(!doc.rows.length);
  const [openLine, setOpenLine] = useState<string | null>(initialRowId ?? null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [fields, setFields] = useState<EditFields | null>(null);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<keyof EditFields>();
  const [showOriginal, setShowOriginal] = useState(false);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const ledgerTop = useRef(0);
  const rowOffsets = useRef<Record<string, number>>({});
  const mediaType = original?.type ?? doc.media_type;
  const photo = original?.type.startsWith('image/') && !previewUnavailable ? original : undefined;
  const hasSourceText = doc.pages.some(page => page.trim());
  const chargeCount = rows.filter(row => row.type === 'charge').length;

  function returnToRow(rowId: string) {
    Keyboard.dismiss();
    const offset = rowOffsets.current[rowId];
    if (offset !== undefined) scroll.current?.scrollTo({ y: Math.max(0, ledgerTop.current + offset - 12), animated: false });
  }

  function edit(row: Row) {
    setEditing(row);
    setFields(editable(row));
    setFieldError(undefined);
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
    let field: keyof EditFields = 'description';
    try {
      if (!fields.description.trim()) throw new Error('Enter a description.');
      field = 'page';
      const page = number(fields.page, 'source page')!;
      if (page > doc.pages.length) throw new Error('Choose a page in this document.');
      field = 'line';
      const line = number(fields.line, 'source line')!;
      if (line > (doc.pages[page - 1] ?? '').split('\n').length) throw new Error('Choose a line on this page.');
      field = 'units';
      const units = number(fields.units, 'quantity', true);
      field = 'amount';
      const value = parseRupees(fields.amount);
      field = 'unit_price';
      const unitPrice = parseRupees(fields.unit_price);
      const row: Row = {
        ...editing, description: fields.description.trim(), page, line,
        code: fields.code.trim(), service_date: fields.service_date.trim(), reference: fields.reference.trim(),
        units, amount: value, unit_price: unitPrice,
      };
      setRows((current) => current.some((item) => item.id === row.id)
        ? current.map((item) => item.id === row.id ? row : item)
        : [...current, row]);
      returnToRow(row.id);
      setEditing(null);
      setFieldError(undefined);
      setError('');
    } catch (cause) {
      setFieldError(field);
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
    if (editing) returnToRow(editing.id);
    setFieldError(undefined);
    setEditing(null);
    setError('');
  }

  function close() {
    if (busy) return;
    if (editing) {
      if (JSON.stringify(fields) !== JSON.stringify(editable(editing))) {
        Alert.alert('Leave this edit?', 'Your other corrections will stay in this review.', [
          { text: 'Keep editing', style: 'cancel' }, { text: 'Discard this edit', style: 'destructive', onPress: cancelEdit },
        ]);
      } else cancelEdit();
      return;
    }
    if (changed) {
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
                error={fieldError === key} onChangeText={(value) => {
                  setFields((current) => current && { ...current, [key]: value });
                  if (fieldError === key) { setFieldError(undefined); setError(''); }
                }} />
              {fieldError === key && <Message text={error} />}
            </View>
          ))}
          <Button label="Save row" icon="check" onPress={saveRow} />
          {rows.some((row) => row.id === editing.id) && <Button label="Remove row" icon="trash-2" tone="destructive"
            onPress={() => { setRows((current) => current.filter((row) => row.id !== editing.id)); setEditing(null); setError(''); }} />}
    <Button label="Cancel row edit" tone="ghost" onPress={cancelEdit} />
  </View> : null;

  const selectedRow = rows.find((row) => row.id === initialRowId);

  return <Sheet title={doc.id === 'second-order' ? 'Second lab order' : KINDS[doc.kind]} onClose={close}>
    <KeyboardAvoidingView style={ui.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
        <Animated.View entering={evidenceReveal} style={styles.intro}>
          <Illustration name={selectedRow ? 'evidence' : 'confirm'} size={48} />
          <View style={styles.introText}>
            <Text accessibilityRole="header" style={ui.title}>{doc.confirmed ? 'Document lines' : doc.kind === 'invoice' ? 'Review extracted charges' : 'Review extracted lines'}</Text>
            <View style={styles.metadata}>
              <Text style={ui.small}>{doc.kind === 'invoice' ? `${chargeCount} ${chargeCount === 1 ? 'charge' : 'charges'}` : `${rows.length} ${rows.length === 1 ? 'line' : 'lines'}`}</Text>
              <Text accessibilityElementsHidden importantForAccessibility="no" style={ui.small}>·</Text>
              <Text style={ui.small}>{doc.pages.length} {doc.pages.length === 1 ? 'source page' : 'source pages'}</Text>
            </View>
            {(changed || editing || doc.confirmed) && <Badge tone={changed || editing ? 'amber' : 'green'}>
              {changed || editing ? 'Unsaved' : 'Confirmed'}
            </Badge>}
          </View>
        </Animated.View>
        <Card>
          <View style={styles.sourceSummary}>
            {photo && <Image source={{ uri: photo.uri }} resizeMode="contain" style={styles.thumbnail}
              accessibilityLabel="Captured bill thumbnail" onError={() => setPreviewUnavailable(true)} />}
            <View style={ui.grow}>
              <Text style={ui.label}>{mediaType === 'application/pdf' ? 'Imported PDF'
                : mediaType?.startsWith('image/') ? 'Captured or imported image' : 'Pasted document text'}</Text>
              <Text style={ui.small}>{doc.confirmed ? 'Compare with the source below.' : 'Compare each line with the bill before confirming.'}</Text>
            </View>
          </View>
          {photo ? <>
            <Button label={showOriginal ? 'Hide original image' : 'View original image'} tone="light" icon="image"
              onPress={() => setShowOriginal(!showOriginal)} />
            {showOriginal && <Image source={{ uri: photo.uri }} resizeMode="contain" style={styles.originalImage}
              accessibilityLabel="Original bill image" onError={() => setPreviewUnavailable(true)} />}
          </> : null}
          {hasSourceText && <View>
            <Disclosure label={source ? 'Hide extracted text' : 'Show extracted text'} open={source} onToggle={() => setSource(!source)}>
              {doc.pages.map((page, index) => <View key={index} style={styles.original}>
                <Text style={ui.kicker}>Page {index + 1}</Text>
                <CurrencyText selectable style={styles.raw}>{page.trim() ? page.split(/\r?\n/).map((line, i) => `${i + 1}  ${line}`).join('\n') : 'No text found'}</CurrencyText>
              </View>)}
            </Disclosure>
          </View>}
        </Card>
        {selectedRow && <Animated.View entering={evidenceReveal} style={[ui.stack, styles.highlight]}>
          <Text style={ui.label}>Linked source · Page {selectedRow.page}, line {selectedRow.line}</Text>
          <CurrencyText selectable style={ui.body}>{doc.pages[selectedRow.page - 1]?.split(/\r?\n/)[selectedRow.line - 1] || 'No text found on this line.'}</CurrencyText>
        </Animated.View>}
        {rows.length > 0 ? <View style={styles.ledger} onLayout={(event) => { ledgerTop.current = event.nativeEvent.layout.y; }}>
          {rows.map((row, index) => {
            const isTotal = row.type === 'invoice_total';
            const isOpen = openLine === row.id;
            const flagged = doc.notes.some((note) => note.startsWith(`Page ${row.page}, line ${row.line} `));
            const units = row.units === null ? '' : `${row.units} ${row.units === 1 ? 'unit' : 'units'}`;
            const detail = [units && row.unit_price !== null ? `${units} × ${money(row.unit_price)}` : units,
              isTotal || row.type === 'charge' ? '' : ROW_LABEL[row.type], flagged ? 'Needs review' : '',
              row.received === false ? 'Service not received' : ''].filter(Boolean).join(' · ');
            return <View key={row.id} style={[index > 0 && styles.lineRule, isTotal && styles.totalStrip]}
              onLayout={(event) => { rowOffsets.current[row.id] = event.nativeEvent.layout.y; }}>
              <View style={styles.rowActions}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Source for ${row.description}, page ${row.page}, line ${row.line}`}
                  accessibilityValue={{ text: [row.amount !== null ? money(row.amount) : '', detail].filter(Boolean).join(', ') }}
                  accessibilityHint="Opens the source text and available actions" accessibilityState={{ expanded: isOpen }}
                  onPress={() => setOpenLine(isOpen ? null : row.id)} style={({ pressed }) => [styles.ledgerLine, pressed && styles.pressed]}>
                  <View style={styles.lineSummary}>
                    <Text style={isTotal ? styles.totalLabel : styles.lineTitle}>{row.description}</Text>
                    {!!detail && <CurrencyText style={ui.small}>{detail}</CurrencyText>}
                  </View>
                  {row.amount !== null && <Text style={[styles.amount, isTotal && styles.totalAmount]}>{money(row.amount)}</Text>}
                  <AppIcon name={isOpen ? 'chevron-up' : 'chevron-down'} size={15} color={color.muted} />
                </Pressable>
                {!readOnly && !editing && !busy && <IconButton label={`Edit ${row.description}, line ${index + 1}`}
                  icon="edit-2" onPress={() => edit(row)} />}
              </View>
              {flagged && <View style={styles.lineWarning}>
                <Text style={ui.small}>Check this extraction against the bill.</Text>
              </View>}
              {isOpen && <Animated.View entering={evidenceReveal} style={styles.lineDetails}>
                <Text style={ui.kicker}>Page {row.page}, line {row.line}</Text>
                <CurrencyText selectable style={styles.quote}>{doc.pages[row.page - 1]?.split(/\r?\n/)[row.line - 1]?.trim()
                  || 'No text found on this line.'}</CurrencyText>
                {!!row.reference && <Text style={ui.small}>{row.reference}</Text>}
                {!readOnly && row.type === 'charge' && <Pressable accessibilityRole="checkbox" accessibilityLabel="I did not receive this service"
                  disabled={!!editing || busy} accessibilityState={{ checked: row.received === false, disabled: !!editing || busy }}
                  onPress={() => setRows((current) => current.map((item) => item.id === row.id
                    ? { ...item, received: item.received === false ? null : false } : item))}
                  style={styles.received}>
                  <AppIcon name={row.received === false ? 'check-square' : 'square'} size={19} color={color.primary} />
                  <Text style={ui.small}>I did not receive this service</Text>
                </Pressable>}
              </Animated.View>}
              {editing?.id === row.id && <View style={styles.lineDetails}>{editor}</View>}
            </View>;
          })}
        </View> : <View style={styles.empty}>
          <Illustration name="confirm" size={46} />
          <Text style={ui.heading}>{doc.pages.some((page) => page.trim()) ? 'Review the extracted text' : 'No readable text found'}</Text>
          <Text style={ui.body}>{doc.pages.some((page) => page.trim())
            ? (readOnly ? 'The extracted text could not be grouped into bill lines.' : 'Use the extracted text to add each line you recognise.')
            : (readOnly ? 'This document contains no readable lines.' : 'Try a sharper photo or paste the itemised text.')}</Text>
          {!readOnly && !doc.confirmed && <Button label="Replace unreadable document" tone="light"
            disabled={busy || !!editing} onPress={() => {
              void onReplace().catch((cause) => setError((cause as Error).message));
            }} />}
        </View>}
        {doc.notes.length > 0 && <View style={styles.notes}>
          <AppIcon name="alert-circle" size={17} color={color.question} />
          <View style={[ui.grow, {gap: 4}]}>
            {doc.notes.slice(0, source ? undefined : 1).map((note, index) => <Text key={index} style={ui.small}>{note}</Text>)}
            {!source && doc.notes.length > 1 && <Text style={ui.small}>Open extracted text for all {doc.notes.length} notes.</Text>}
          </View>
        </View>}
          {editing && !editingExisting && <View style={ui.card}>{editor}</View>}
          {!readOnly && ROWS[doc.kind].map((type) => <Button key={type} label={`Add ${ROW_LABEL[type].toLowerCase()}`} icon="plus"
            tone="ghost" disabled={busy || !!editing} onPress={() => add(type)} />)}
          {error && !editing ? <Message text={error} /> : null}
          {!readOnly && !doc.confirmed && <Button label="Discard unconfirmed import" icon="trash-2" tone="destructive"
            disabled={busy || !!editing} onPress={() => void discard()} />}
      </ScrollView>
      {!editing && (!readOnly || !doc.confirmed) && <ActionBar>
          <Button label={doc.kind === 'invoice' ? 'Confirm charges' : 'Confirm document lines'} icon="check"
            disabled={!rows.length || !!editing} busy={busy} onPress={() => void confirm()} />
      </ActionBar>}
    </KeyboardAvoidingView>
  </Sheet>;
}

const useStyles = themedStyles(({ color }) => StyleSheet.create({
  intro: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  introText: { flex: 1, gap: 6 },
  metadata: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  ledger: { backgroundColor: color.card, borderWidth: 1, borderColor: color.line, borderRadius: 18, overflow: 'hidden' },
  lineRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  rowActions: { flexDirection: 'row', alignItems: 'center', paddingRight: 6 },
  lineWarning: { paddingHorizontal: 16, paddingBottom: 8 },
  sourceSummary: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumbnail: { width: 56, height: 56, borderRadius: 8, backgroundColor: color.surfaceContainer },
  originalImage: { width: '100%', height: 300, backgroundColor: color.surfaceContainer, borderRadius: 12 },
  ledgerLine: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 15, gap: 8, minHeight: 60 },
  lineSummary: { flexGrow: 1, flexBasis: 125, gap: 3 },
  lineTitle: { fontFamily: font.semibold, fontSize: 17, lineHeight: 22, color: color.ink },
  amount: { fontFamily: font.uiSans, fontSize: 15, color: color.ink, fontVariant: ['tabular-nums'], flexShrink: 1 },
  totalStrip: { backgroundColor: color.primaryContainer },
  totalLabel: { fontFamily: font.display, fontSize: 23, color: color.onPrimaryContainer },
  totalAmount: { fontSize: 17, color: color.onPrimaryContainer },
  lineDetails: { gap: 8, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 16 },
  quote: { borderLeftWidth: 2, borderLeftColor: color.primary, paddingLeft: 10, fontFamily: font.regular, color: color.ink, fontSize: 15, lineHeight: 21 },
  received: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  pressed: { opacity: 0.7 },
  notes: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 2 },
  empty: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: color.line, paddingVertical: 17, gap: 6 },
  original: { gap: 5 },
  raw: { fontFamily: font.mono, fontSize: 13, lineHeight: 20, color: color.ink },
  highlight: { padding: 12, backgroundColor: color.tertiaryContainer, borderRadius: 8 },
  option: { minHeight: 48, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12 },
  selected: { backgroundColor: color.secondaryContainer },
}));
