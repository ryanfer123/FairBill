import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Document, Kind, KINDS, money, Row, RowType } from './api';
import { Badge, Button, Divider, EmptyState, IconButton, LoadingState, Message, Sheet, color, ui } from './ui';

type Asset = { uri: string; name: string; type: string };

export function Intake({ busy, startKind, onClose, onPaste, onFile }:
  { busy: boolean; startKind: Kind; onClose: () => void; onPaste: (kind: Kind, text: string) => Promise<void>;
    onFile: (kind: Kind, asset: Asset) => Promise<void> }) {
  const [kind, setKind] = useState<Kind>(startKind);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const disabled = picking || busy;

  async function pick(method: 'file' | 'photo' | 'camera') {
    setError('');
    setPicking(true);
    try {
      if (method === 'file') {
        const result = await DocumentPicker.getDocumentAsync({
          type: ['application/pdf', 'image/png', 'image/jpeg'],
          copyToCacheDirectory: true,
        });
        const asset = result.assets?.[0];
        if (asset) await onFile(kind, { uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'application/octet-stream' });
      } else {
        if (method === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
          setError('Allow camera access in Android Settings or choose an existing image.');
          return;
        }
        const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.85, exif: false };
        const result = method === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
        const asset = result.assets?.[0];
        if (asset) await onFile(kind, {
          uri: asset.uri, name: asset.fileName ?? 'scan.jpg', type: asset.mimeType ?? 'image/jpeg',
        });
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPicking(false);
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
        <Text style={ui.body}>Use synthetic documents for this demo. Files are read by the local server.</Text>
        <View style={ui.card}>
          <Text style={ui.label}>Document type</Text>
          {(Object.keys(KINDS) as Kind[]).map((value) => (
            <Pressable key={value} accessibilityRole="radio" accessibilityLabel={KINDS[value]} accessibilityState={{ checked: value === kind, disabled }}
              disabled={disabled} onPress={() => setKind(value)}
              style={[ui.row, { minHeight: 44, paddingHorizontal: 4 }]}>
              <Feather name={value === kind ? 'check-circle' : 'circle'} size={18} color={color.forest} />
              <Text style={ui.label}>{KINDS[value]}</Text>
            </Pressable>
          ))}
        </View>
        <Button label="Take a photo" icon="camera" busy={picking} disabled={busy} onPress={() => void pick('camera')} />
        <View style={ui.row}>
          <View style={ui.grow}><Button label="Choose photo" icon="image" tone="ghost" disabled={disabled} onPress={() => void pick('photo')} /></View>
          <View style={ui.grow}><Button label="Choose file" icon="folder" tone="ghost" disabled={disabled} onPress={() => void pick('file')} /></View>
        </View>
        <View style={ui.card}>
          <Text style={ui.label}>Paste document text</Text>
          <TextInput value={body} onChangeText={setBody} placeholder="Paste the text here" placeholderTextColor={color.muted}
            accessibilityLabel="Document text" style={[ui.input, { minHeight: 110, textAlignVertical: 'top' }]}
            multiline maxLength={20000} editable={!disabled} />
          <Button label="Review pasted text" icon="arrow-right" tone="ghost" disabled={disabled || !body.trim()} onPress={() => void paste()} />
        </View>
        {busy && <LoadingState label="Reading document…" />}
        {error ? <Message text={error} /> : null}
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

function parseAmount(value: string) {
  const cleaned = value.trim().replace(/[₹,]/g, '');
  if (!cleaned) return null;
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(cleaned)) throw new Error('Use a rupee amount with up to two decimal places.');
  const [whole = '', fraction = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
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

export function Review({ doc, busy, onClose, onConfirm, onDiscard }:
  { doc: Document; busy: boolean; onClose: () => void; onConfirm: (rows: Row[]) => Promise<void>;
    onDiscard: () => Promise<void> }) {
  const [rows, setRows] = useState(doc.rows);
  const [source, setSource] = useState(false);
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
        units: number(fields.units, 'quantity', true), amount: parseAmount(fields.amount),
        unit_price: parseAmount(fields.unit_price),
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
              <Text style={ui.label}>{label}</Text>
              <TextInput accessibilityLabel={label} value={fields[key]} keyboardType={keyboardType} style={ui.input}
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

  return <Sheet title={KINDS[doc.kind]} onClose={close}>
    <KeyboardAvoidingView style={ui.grow} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
          <Text style={ui.body}>Compare each row with the document and correct any misreads.</Text>
          <Badge tone={changed || editing ? 'amber' : 'neutral'}>{changed || editing ? 'Unsaved changes' : doc.confirmed ? 'Confirmed' : 'Awaiting confirmation'}</Badge>
          <Button label={source ? 'Hide extracted text' : 'Show extracted text'} icon="file-text" tone="ghost" onPress={() => setSource(!source)} />
          {source && doc.pages.map((page, index) => <View key={index} style={ui.card}>
            <Text style={ui.kicker}>PAGE {index + 1}</Text>
            <Text selectable style={ui.small}>{page.split('\n').map((line, i) => `${i + 1}  ${line}`).join('\n') || 'No text found'}</Text>
          </View>)}
          {doc.notes.length > 0 && <View style={ui.card}>
            <Text style={ui.label}>Needs review</Text>
            <Text style={ui.small}>{doc.notes.slice(0, 6).join(' ')}</Text>
          </View>}
          {!rows.length && !editing && <EmptyState>No rows were extracted. Add a row using the source text.</EmptyState>}
          {rows.length > 0 && <View style={ui.card}>
          <Text style={ui.kicker}>DOCUMENT ROWS</Text>
          {rows.map((row) => <View key={row.id} style={ui.stack}>
            <Divider />
            <View style={ui.between}>
              <View style={ui.grow}>
                <Text style={ui.kicker}>{ROW_LABEL[row.type].toUpperCase()} · PAGE {row.page} · LINE {row.line}</Text>
                <Text style={ui.label}>{row.description}</Text>
              </View>
              {row.amount !== null && <Text style={ui.money}>{money(row.amount)}</Text>}
              {!editing && !busy && <IconButton label={`Edit ${row.description}`} icon="edit-2" onPress={() => edit(row)} />}
            </View>
            {row.units !== null && <Text style={ui.small}>{row.units} units</Text>}
            {doc.notes.some((note) => note.startsWith(`Page ${row.page}, line ${row.line} `)) &&
              <Text style={ui.small}>Extraction needs review</Text>}
            {row.type === 'charge' && <Pressable accessibilityRole="checkbox" accessibilityLabel="I did not receive this service" disabled={!!editing || busy}
              accessibilityState={{ checked: row.received === false, disabled: !!editing || busy }}
              onPress={() => setRows((current) => current.map((item) => item.id === row.id
                ? { ...item, received: item.received === false ? null : false } : item))}
              style={[ui.row, { minHeight: 44 }]}>
              <Feather name={row.received === false ? 'check-square' : 'square'} size={17} color={color.ink} />
              <Text style={ui.small}>I did not receive this service</Text>
            </Pressable>}
            {!!row.reference && <Badge>{row.reference}</Badge>}
            {editing?.id === row.id && editor}
          </View>)}
          </View>}
          {editing && !editingExisting && <View style={ui.card}>{editor}</View>}
          {ROWS[doc.kind].map((type) => <Button key={type} label={`Add ${ROW_LABEL[type].toLowerCase()}`} icon="plus"
            tone="ghost" disabled={busy || !!editing} onPress={() => add(type)} />)}
          {error && !editing ? <Message text={error} /> : null}
          <Button label={`Confirm ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`} icon="check"
            disabled={!rows.length || !!editing} busy={busy} onPress={() => void confirm()} />
          {!doc.confirmed && <Button label="Discard unconfirmed import" icon="trash-2" tone="destructive"
            disabled={busy || !!editing} onPress={() => void discard()} />}
      </ScrollView>
    </KeyboardAvoidingView>
  </Sheet>;
}
