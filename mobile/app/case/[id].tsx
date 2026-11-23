import { Feather } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConnectionStatus } from '../../src/connection';
import { Action, ApiError, Case, History, KINDS, Kind, Row, endpoint, getCase, headers, postCase, request } from '../../src/api';
import { Intake, Review } from '../../src/intake';
import { Outreach } from '../../src/outreach';
import { Evidence, type EvidenceView, FindingCard, RevisionComparison, ScenarioCard, Timeline } from '../../src/results';
import { Badge, Button, Card, Divider, EmptyState, IconButton, LoadingState, Message, Screen, SectionHeader, Sheet, color, ui } from '../../src/ui';

type Overlay = { type: 'intake' } | { type: 'review'; id: string } | { type: 'evidence'; entry: EvidenceView; returnTo?: History }
  | { type: 'revision'; revision: History } | { type: 'action'; action: Action } | { type: 'packet'; lines: string[] };
type Tab = 'Review' | 'Documents' | 'Timeline';
const caseID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export default function CaseScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' && caseID.test(params.id) ? params.id : '';
  const [data, setData] = useState<Case>();
  const [busy, setBusy] = useState('');
  const working = useRef(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('Review');
  const [overlay, setOverlay] = useState<Overlay>();

  const refresh = useCallback(async () => {
    setError('');
    if (!id) { setError('This case link is invalid.'); return; }
    try { setData(await getCase(id)); } catch (cause) { setError((cause as Error).message); }
  }, [id]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function update(label: string, suffix: string, body: object | FormData) {
    if (working.current) throw new Error('An action is already in progress.');
    working.current = true;
    setError('');
    setBusy(label);
    try {
      const next = await postCase(`/cases/${id}${suffix}`, body);
      setData(next);
      return next;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        try { setData(await getCase(id)); } catch { /* Keep the operation error. */ }
      }
      throw cause;
    } finally {
      setBusy('');
      working.current = false;
    }
  }

  function report(cause: unknown) { setError((cause as Error).message); }
  function close() { if (!busy) { setError(''); setOverlay(undefined); } }

  if (!data) return <Screen>
    <View style={ui.content}>
      <IconButton label="Back to FairBill" icon="arrow-left" onPress={() => router.back()} />
      {error ? <><Message text={error} /><Button label="Retry" icon="refresh-cw" onPress={() => void refresh()} /></>
        : <LoadingState label="Loading case" />}
    </View>
  </Screen>;

  const revision = data.revision;
  const ready = revision === data.investigated_revision;
  const pending = data.documents.find((doc) => !doc.confirmed);
  const hasInvoice = data.documents.some((doc) => doc.kind === 'invoice' && doc.confirmed);
  const canAddOrder = data.sample && !data.documents.some((doc) => doc.id === 'second-order');
  const reviewing = overlay?.type === 'review' ? data.documents.find((doc) => doc.id === overlay.id) : undefined;
  const action = overlay?.type === 'action' ? overlay.action : null;
  const draft = action ? data.drafts[action] : undefined;
  const approved = !!draft && data.approvals[draft.action]?.hash === draft.hash;
  const receipt = draft ? data.receipts[`${draft.revision}:${draft.action}:${draft.hash}`] : undefined;

  async function run() {
    try {
      await update('investigate', '/investigate', { revision });
      setTab('Review');
    } catch (cause) { report(cause); }
  }

  function reviewNew(next: Case) {
    const doc = next.documents.at(-1);
    if (doc) setOverlay({ type: 'review', id: doc.id });
  }

  async function confirm(rows: Row[]) {
    if (!reviewing) return;
    await update('confirm', `/documents/${reviewing.id}/confirm`, { revision, rows });
    setOverlay(undefined);
    setTab('Review');
  }

  async function prepare(nextAction: Action) {
    try {
      await update(`draft-${nextAction}`, '/drafts', { revision, action: nextAction });
      setOverlay({ type: 'action', action: nextAction });
    } catch (cause) { report(cause); }
  }

  async function simulate(step: 'start' | 'identity' | 'finish') {
    if (!draft) return;
    try {
      await update('simulation', '/simulations', { revision, action: draft.action, hash: draft.hash, step });
    } catch (cause) { report(cause); }
  }

  async function share() {
    if (working.current) return;
    working.current = true;
    setBusy('share');
    setError('');
    try {
      const directory = FileSystem.cacheDirectory;
      if (!directory || !(await Sharing.isAvailableAsync())) throw new Error('File sharing is unavailable on this device.');
      const filename = `${directory}FairBill-evidence.pdf`;
      await FileSystem.deleteAsync(filename, { idempotent: true });
      const result = await FileSystem.downloadAsync(
        `${await endpoint()}/cases/${id}/packet?revision=${revision}`, filename, { headers: await headers() },
      );
      if (result.status !== 200 || !result.headers['Content-Type']?.includes('pdf')
        && !result.headers['content-type']?.includes('pdf')) {
        await FileSystem.deleteAsync(filename, { idempotent: true });
        throw new Error('The evidence packet could not be downloaded for this revision.');
      }
      await Sharing.shareAsync(result.uri, { mimeType: 'application/pdf', dialogTitle: 'Share redacted FairBill packet' });
    } catch (cause) { report(cause); } finally { setBusy(''); working.current = false; }
  }

  async function previewPacket() {
    if (working.current) return;
    working.current = true;
    setBusy('preview');
    setError('');
    try {
      const result = await request<{ lines: string[] }>(`/cases/${id}/packet?revision=${revision}&preview=true`);
      setOverlay({ type: 'packet', lines: result.lines });
    } catch (cause) {
      report(cause);
    } finally {
      setBusy('');
      working.current = false;
    }
  }

  const openEvidence = (entry: EvidenceView) => setOverlay({ type: 'evidence', entry });
  const addEvidence = () => setOverlay({ type: 'intake' });
  return <Screen>
    <View style={[ui.between, styles.toolbar]}>
      <IconButton label="Back to FairBill" icon="arrow-left" onPress={() => { if (!busy) router.back(); }} />
      <View style={ui.grow}>
        <Text style={ui.kicker}>FAIRBILL · SYNTHETIC DEMO</Text>
        <Text style={ui.label}>{data.sample ? 'Sample investigation' : 'Hospital bill case'}</Text>
      </View>
      <IconButton label="Add evidence" icon="plus" onPress={() => { if (!busy) addEvidence(); }} />
    </View>
    <ConnectionStatus mode={data.agent_mode} />
    <View style={styles.tabs}>
      {(['Review', 'Documents', 'Timeline'] as Tab[]).map((name) => <Pressable key={name} accessibilityRole="tab" accessibilityLabel={name}
        accessibilityState={{ selected: tab === name }} onPress={() => setTab(name)}
        style={[styles.tab, name === tab && styles.tabActive]}>
        <Text style={[styles.tabLabel, name === tab && { color: color.ink }]}>{name}</Text>
      </Pressable>)}
    </View>
    <ScrollView key={tab} contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
      {error && !overlay && <Message text={error} onClose={() => setError('')} />}
      {tab === 'Review' && <>
        <View style={ui.between}>
          <Text style={[ui.title, ui.grow]}>Case review</Text>
          <Badge tone="neutral">Rev {revision}</Badge>
        </View>
        <ScenarioCard data={data} stale={!ready} onEvidence={openEvidence} />
        {!ready && <View style={ui.card}>
          <Text style={ui.label}>{pending ? 'Document needs confirmation' : hasInvoice ? 'Ready to investigate' : 'Add your hospital invoice'}</Text>
          <Text style={ui.body}>{pending ? 'Review the source and confirm the extracted rows.' : hasInvoice
            ? 'Check the confirmed documents for billing questions and insurance deductions.'
            : 'Scan a printed invoice, import a file, or paste the text to start.'}</Text>
          {pending ? <Button label="Review document" icon="arrow-right" onPress={() => setOverlay({ type: 'review', id: pending.id })} />
            : hasInvoice ? <Button label={data.history.length ? 'Re-run investigation' : 'Run investigation'} icon="search"
              busy={busy === 'investigate'} disabled={!!busy} onPress={() => void run()} />
              : <Button label="Add invoice" icon="plus" onPress={addEvidence} />}
        </View>}
        {ready && <>
          {canAddOrder && <View style={[ui.card, { backgroundColor: color.pale }]}>
            <View style={ui.row}>
              <Feather name="file-plus" color={color.forest} size={21} />
              <Text style={[ui.label, ui.grow]}>A second lab order is available</Text>
            </View>
            <Text style={ui.small}>Add it to see how new evidence changes the calculation.</Text>
            <Button label="Add second lab order" icon="plus" tone="ghost" busy={busy === 'sample-order'} disabled={!!busy}
              onPress={() => { void update('sample-order', '/documents/sample-order', { revision }).then(reviewNew).catch(report); }} />
          </View>}
          <SectionHeader>Billing questions</SectionHeader>
          {data.findings.filter((item) => item.check !== 'settlement').map((finding) => <FindingCard key={finding.id} finding={finding}
            onPress={openEvidence} />)}
          {data.findings.every((item) => item.check === 'settlement') && <EmptyState>No billing questions surfaced from the confirmed rows.</EmptyState>}
          <SectionHeader>Insurance review</SectionHeader>
          {data.findings.filter((item) => item.check === 'settlement').map((finding) => <FindingCard key={finding.id} finding={finding}
            onPress={openEvidence} />)}
          {data.findings.every((item) => item.check !== 'settlement') && <EmptyState>Add a settlement statement to check deductions.</EmptyState>}
          <View style={ui.card}>
            <SectionHeader>Next steps</SectionHeader>
            <Button label="Draft clarification letter" icon="mail" disabled={!!busy} busy={busy === 'draft-letter'} onPress={() => void prepare('letter')} />
            <Button label="Review three-way call plan" icon="phone-call" tone="ghost" disabled={!!busy}
              busy={busy === 'draft-call'} onPress={() => void prepare('call')} />
            <Button label="Preview evidence packet" icon="share-2" tone="ghost" busy={busy === 'preview'}
              disabled={!!busy} onPress={() => void previewPacket()} />
          </View>
        </>}
      </>}
      {tab === 'Documents' && <>
        <Text style={ui.title}>Documents</Text>
        {data.documents.length > 0 ? <Card>
          {data.documents.map((doc, index) => <View key={doc.id}>
            {index > 0 && <Divider />}
            <Pressable accessibilityRole="button" accessibilityLabel={doc.id === 'second-order' ? 'Second lab order' : KINDS[doc.kind]}
              accessibilityState={{ disabled: !!busy }} disabled={!!busy}
              onPress={() => setOverlay({ type: 'review', id: doc.id })} style={[ui.between, styles.documentRow]}>
              <Feather name="file-text" size={20} color={color.forest} />
              <View style={ui.grow}>
                <Text style={ui.label}>{doc.id === 'second-order' ? 'Second lab order' : KINDS[doc.kind]}</Text>
                <Text style={ui.small}>{doc.rows.length} rows · {doc.confirmed ? 'Confirmed' : 'Needs review'}</Text>
              </View>
              <Feather name="chevron-right" color={color.muted} size={18} />
            </Pressable>
          </View>)}
        </Card> : <EmptyState>No documents in this case yet.</EmptyState>}
        <Button label="Add evidence" icon="plus" onPress={addEvidence} disabled={!!busy} />
      </>}
      {tab === 'Timeline' && <>
        <Text style={ui.title}>Timeline</Text>
        <Timeline data={data} onRevision={(entry) => setOverlay({ type: 'revision', revision: entry })} />
      </>}
    </ScrollView>
    {overlay?.type === 'intake' && <Intake busy={!!busy} startKind={hasInvoice ? 'service_record' : 'invoice'} onClose={close}
      onPaste={async (kind: Kind, text: string) => reviewNew(await update('import', '/documents/text', { kind, text, revision }))}
      onFile={async (kind, asset) => {
        const form = new FormData();
        form.append('kind', kind);
        form.append('revision', String(revision));
        form.append('file', asset as unknown as Blob);
        reviewNew(await update('import', '/documents/file', form));
      }} />}
    {reviewing && <Review key={reviewing.id} doc={reviewing} busy={!!busy} onClose={close} onConfirm={confirm}
      onDiscard={async () => {
        await update('discard', `/documents/${reviewing.id}/discard`, { revision });
        setOverlay(undefined);
      }} />}
    {overlay?.type === 'evidence' && <Evidence entry={overlay.entry} onClose={() => {
      if (overlay.returnTo) setOverlay({ type: 'revision', revision: overlay.returnTo });
      else close();
    }} />}
    {overlay?.type === 'revision' && <Sheet title={`Revision ${overlay.revision.revision}`} onClose={close}>
      <ScrollView contentContainerStyle={ui.content}>
        <RevisionComparison data={data} item={overlay.revision} />
        {overlay.revision.findings.map((finding) => <FindingCard key={finding.id} finding={finding}
          onPress={(entry) => setOverlay({ type: 'evidence', entry, returnTo: overlay.revision })} />)}
      </ScrollView>
    </Sheet>}
    {action && <Outreach action={action} draft={draft} approved={approved} receipt={receipt} busy={busy}
      error={error} onDismissError={() => setError('')} onClose={close}
      onApprove={() => {
        if (draft) void update('approve', '/approvals', { action, revision, hash: draft.hash }).catch(report);
      }}
      onSimulate={(step) => void simulate(step)} />}
    {overlay?.type === 'packet' && <Sheet title="Redacted packet" onClose={close}>
      <ScrollView contentContainerStyle={ui.content}>
        <Card>
          <View style={ui.row}>
            <Feather name="shield" size={20} color={color.forest} />
            <SectionHeader>Redactions</SectionHeader>
          </View>
          <Text style={ui.body}>Uploaded source text and patient-entered excerpts are excluded. The packet retains source locations, findings, amounts, and revision history.</Text>
        </Card>
        {error ? <Message text={error} /> : null}
        {overlay.lines.length ? <Card>
          <SectionHeader>{overlay.lines[0]}</SectionHeader>
          {overlay.lines.slice(1).join('\n').split(/\n{2,}/).filter((section) => section.trim()).map((section, index) =>
            <View key={index} style={ui.stack}>
              <Divider />
              <Text selectable style={ui.body}>{section}</Text>
            </View>
          )}
        </Card> : <EmptyState>The preview is empty. Close this view and try again.</EmptyState>}
        <Button label="Share redacted PDF" icon="share-2" busy={busy === 'share'} disabled={!ready || !!busy || !overlay.lines.length} onPress={() => void share()} />
      </ScrollView>
    </Sheet>}
  </Screen>;
}

const styles = StyleSheet.create({
  toolbar: { paddingHorizontal: 20, paddingVertical: 9 },
  documentRow: { minHeight: 54, paddingVertical: 8 },
  tabs: { flexDirection: 'row', paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: color.line, gap: 8 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 46, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: color.forest },
  tabLabel: { color: color.muted, fontWeight: '800', fontSize: 13 },
});
