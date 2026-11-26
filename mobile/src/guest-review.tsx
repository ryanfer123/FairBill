import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Checkbox } from 'react-native-paper';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { getBackend, money, parseRupees, request, type Case } from './api';
import { accountUser } from './cloud-auth';
import { useFairBillTheme } from './theme';
import { Button, Card, CurrencyText, Input, Message, SectionHeader, Sheet } from './ui';

const storageKey = 'fairbill_device_ledger_v1';
const maxAmount = 1_000_000_000;
type Charge = { description: string; units: number; amount: number };
type Ledger = { id: string; rows: Charge[]; invoiceTotal: number | null; transferOwner?: string };

function amount(value: string): number | null {
  const paise = parseRupees(value);
  if (paise !== null && paise > maxAmount) throw new Error('Enter an amount up to ₹1,00,00,000.00.');
  return paise;
}

export function GuestReview({ onClose, onAdopted }: {
  onClose: () => void;
  onAdopted?: (caseData: Case) => void;
}) {
  const { ui } = useFairBillTheme();
  const [ledger, setLedger] = useState<Ledger>();
  const [ready, setReady] = useState(false);
  const [supportsAdoption, setSupportsAdoption] = useState(false);
  const [description, setDescription] = useState('');
  const [units, setUnits] = useState('');
  const [charge, setCharge] = useState('');
  const [invoiceTotal, setInvoiceTotal] = useState('');
  const [consent, setConsent] = useState(false);
  const [remove, setRemove] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const owner = onAdopted ? accountUser()?.id : undefined;
  const locked = !!ledger?.transferOwner;
  const rows = ledger?.rows ?? [];
  const total = rows.reduce((sum, row) => sum + row.amount, 0);

  useEffect(() => {
    let current = true;
    void SecureStore.getItemAsync(storageKey).then((value) => {
      if (!current || !value) return;
      const saved = JSON.parse(value) as Ledger;
      if (!Array.isArray(saved.rows) || typeof saved.id !== 'string') throw new Error('On-device review could not be read.');
      setLedger(saved);
      setInvoiceTotal(saved.invoiceTotal == null ? '' : (saved.invoiceTotal / 100).toFixed(2));
    }).catch(() => {
      if (current) setError('The on-device review could not be read.');
    }).finally(() => {
      if (current) setReady(true);
    });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!owner) return;
    let current = true;
    void getBackend().then((backend) => {
      if (current) setSupportsAdoption(backend.guestAdoption === true);
    }).catch(() => undefined);
    return () => { current = false; };
  }, [owner]);

  async function run(action: () => Promise<void>) {
    if (!ready || working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (cause) { setError((cause as Error).message); }
    finally { working.current = false; setBusy(false); }
  }

  async function save(next: Ledger) {
    const value = JSON.stringify(next);
    if (encodeURIComponent(value).replace(/%[A-F0-9]{2}/g, '.').length > (next.transferOwner ? 1800 : 1720)) {
      throw new Error('Use shorter descriptions to fit this device review.');
    }
    await SecureStore.setItemAsync(storageKey, value);
    setLedger(next);
    setConsent(false);
  }

  function currentLedger() {
    return ledger ?? { id: Crypto.randomUUID(), rows: [], invoiceTotal: null };
  }

  function addCharge() {
    void run(async () => {
      const name = description.trim().replace(/\s+/g, ' ');
      const count = Number(units.trim());
      const paise = amount(charge);
      if (!name || paise === null || !/^\d{1,4}$/.test(units.trim()) || count < 1) {
        throw new Error('Enter a description, a whole quantity and a line amount.');
      }
      const current = currentLedger();
      if (current.rows.length >= 15) throw new Error('An on-device review can hold up to 15 charges.');
      await save({ ...current, rows: [...current.rows, { description: name, units: count, amount: paise }] });
      setDescription('');
      setUnits('');
      setCharge('');
    });
  }

  function transfer() {
    if (!ledger || !owner || !consent || !supportsAdoption || (locked && ledger.transferOwner !== owner)) return;
    void run(async () => {
      const bound = { ...ledger, transferOwner: owner };
      await save(bound);
      const adopted = await request<Case>('/guest-reviews/adopt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest_id: ledger.id, owner_id: owner, rows, invoice_total: ledger.invoiceTotal, consent: true }),
      });
      if (accountUser()?.id !== owner) throw new Error('Your account changed. Return to the same account to finish this transfer.');
      await SecureStore.deleteItemAsync(storageKey);
      setLedger(undefined);
      onAdopted?.(adopted);
    });
  }

  if (locked && ledger?.transferOwner !== owner) return <Sheet title="On-device review" onClose={onClose}>
    <View style={ui.content}>
      <Text style={ui.body}>Sign in to the account that started this transfer to finish it.</Text>
      <Button label="Close on-device review" onPress={onClose} />
    </View>
  </Sheet>;

  return <Sheet title="On-device review" onClose={() => { if (!busy) onClose(); }}>
    <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
      <Text style={ui.body}>Enter charges from your bill to check the total. The ledger stays on this device until you choose to transfer it to your account.</Text>
      {error ? <Message text={error} /> : null}
      <Card>
        <SectionHeader>Bill charges</SectionHeader>
        {rows.map((row, index) => <View key={index} style={ui.stack}>
          <Text style={ui.label}>{row.description}</Text>
          <CurrencyText style={ui.small}>{`${row.units} ${row.units === 1 ? 'unit' : 'units'} · ${money(row.amount)}`}</CurrencyText>
          {!locked && <Button label={`Remove charge ${index + 1}`} tone="ghost" disabled={busy}
            onPress={() => void run(() => save({ ...currentLedger(), rows: rows.filter((_, position) => index !== position) }))} />}
        </View>)}
        {!locked && <>
          <Input label="Charge description" value={description} onChangeText={setDescription} maxLength={72} disabled={busy || !ready} />
          <Input label="Quantity" value={units} onChangeText={setUnits} keyboardType="number-pad" maxLength={4} disabled={busy || !ready} />
          <Input label="Line amount (₹)" value={charge} onChangeText={setCharge} keyboardType="decimal-pad" disabled={busy || !ready} />
          <Button label="Add charge" icon="plus" disabled={busy || !ready} onPress={addCharge} />
        </>}
      </Card>
      <Card>
        <SectionHeader>Compare totals</SectionHeader>
        <CurrencyText style={ui.label}>{`Charges entered: ${money(total)}`}</CurrencyText>
        {!locked && <>
          <Input label="Total printed on the bill (₹)" value={invoiceTotal} onChangeText={setInvoiceTotal}
            keyboardType="decimal-pad" disabled={busy || !ready} />
          <Button label="Save printed total" tone="light" disabled={busy || !ready}
            onPress={() => void run(() => save({ ...currentLedger(), invoiceTotal: amount(invoiceTotal) }))} />
        </>}
        {ledger?.invoiceTotal != null && <CurrencyText style={ui.body}>
          {`Printed total: ${money(ledger.invoiceTotal)} · Difference: ${money(ledger.invoiceTotal - total)}`}
        </CurrencyText>}
      </Card>
      {owner && rows.length > 0 && <Card>
        <SectionHeader>Transfer to your account</SectionHeader>
        {supportsAdoption ? <>
            <Checkbox.Item label="I agree to upload the charges and printed total to my signed-in account."
              status={consent ? 'checked' : 'unchecked'} onPress={() => setConsent(!consent)} disabled={busy} />
            <Button label={locked ? 'Retry account transfer' : 'Transfer to my account'} icon="upload" onPress={transfer} disabled={!consent} busy={busy} />
          </> : <Text style={ui.body}>Transfer becomes available with a compatible server connection.</Text>}
      </Card>}
      {ledger && (remove ? <Card>
        <Text style={ui.body}>Remove the on-device ledger from this phone?</Text>
        <Button label="Remove on-device ledger" tone="destructive" disabled={busy} onPress={() => void run(async () => {
          await SecureStore.deleteItemAsync(storageKey);
          setLedger(undefined);
          setInvoiceTotal('');
          setConsent(false);
          setRemove(false);
        })} />
        <Button label="Keep ledger" tone="ghost" disabled={busy} onPress={() => setRemove(false)} />
      </Card> : <Button label="Clear on-device review" tone="ghost" disabled={busy} onPress={() => setRemove(true)} />)}
    </ScrollView>
  </Sheet>;
}
