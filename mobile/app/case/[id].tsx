import { AppIcon } from '../../src/icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { TouchableRipple } from 'react-native-paper';
import { CaseActions } from '../../src/case-actions';
import { Assistance } from '../../src/assistance';
import { IndiaReview } from '../../src/india-review';
import { cloudBuild } from '../../src/cloud-auth';
import { ConnectionStatus } from '../../src/connection';
import { Action, ApiError, Case, History, KINDS, Kind, Row, apiUrl, getBackend, getCase, headers, hostedBuild, postCase, request } from '../../src/api';
import { documentForm } from '../../src/document-picker';
import { Intake, Review } from '../../src/intake';
import { Outreach, type SimulationStep } from '../../src/outreach';
import { Evidence, type EvidenceView, FindingCard, RevisionComparison, ScenarioCard, Timeline } from '../../src/results';
import { font } from '../../src/typography';
import { ActionBar, Badge, Button, Card, Divider, EmptyState, IconButton, LoadingState, Message, Screen, SectionHeader, Sheet, color, ui } from '../../src/ui';

type Overlay = { type: 'intake' } | { type: 'review'; id: string } | { type: 'evidence'; entry: EvidenceView; returnTo?: History }
  | { type: 'india-review' } | { type: 'assistance' } | { type: 'revision'; revision: History } | { type: 'action'; action: Action } | { type: 'packet'; lines: string[] };
type Tab = 'Review' | 'Documents' | 'Timeline' | 'Actions';
const caseID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function ReviewProgress({ stage }: { stage: 0 | 1 | 2 }) {
  const labels = ['Add bill', 'Confirm lines', 'Run checks'];
  return <View accessible accessibilityLabel={`Current step. ${labels[stage]}`} style={styles.progress}>
    {labels.map((label, index) => <View key={label} style={styles.progressStep}>
      <View style={[styles.progressLine, index <= stage && styles.progressActive]} />
      <View style={styles.progressLabel}>
        {index < stage && <AppIcon name="check" size={13} color={color.primary} />}
        {index === stage && <View style={styles.progressDot} />}
        <Text style={[ui.kicker, index === stage && styles.progressCurrent]}>{label}</Text>
      </View>
    </View>)}
  </View>;
}

export default function CaseScreen() {
  const params = useLocalSearchParams<{ id: string; document?: string; section?: string }>();
  const id = typeof params.id === 'string' && caseID.test(params.id) ? params.id : '';
  const [data, setData] = useState<Case>();
  const [versioned, setVersioned] = useState(false);
  const [busy, setBusy] = useState('');
  const working = useRef(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('Review');
  const [overlay, setOverlay] = useState<Overlay>();
  const [directed, setDirected] = useState(false);

  useEffect(() => {
    if (!data || directed) return;
    setDirected(true);
    if (params.document && data.documents.some((doc) => doc.id === params.document && !doc.confirmed)) {
      setOverlay({ type: 'review', id: params.document });
    } else if (params.section === 'aid' && versioned && data.investigated_revision === data.revision) {
      setOverlay({ type: 'assistance' });
    } else if (params.section === 'act' && data.investigated_revision === data.revision) {
      setTab('Actions');
    }
  }, [data, directed, params.document, params.section, versioned]);

  const refresh = useCallback(async () => {
    setError('');
    if (!id) { setError('This case link is invalid.'); return; }
    try {
      const [snapshot, backend] = await Promise.all([getCase(id), getBackend()]);
      setVersioned(backend.prefix === '/v1');
      setData(snapshot);
    } catch (cause) { setError((cause as Error).message); }
  }, [id]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function update(label: string, suffix: string, body: object | FormData, method: 'POST' | 'PATCH' = 'POST') {
    if (working.current) throw new Error('An action is already in progress.');
    working.current = true;
    setError('');
    setBusy(label);
    try {
      const path = `/cases/${id}${suffix}`;
      const next = method === 'PATCH' ? await request<Case>(path, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }) : await postCase(path, body);
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
  const activeTab = !ready && tab === 'Actions' ? 'Review' : tab;
  const pending = data.documents.find((doc) => !doc.confirmed);
  const hasBill = data.documents.some((doc) => doc.kind === 'invoice');
  const hasInvoice = data.documents.some((doc) => doc.kind === 'invoice' && doc.confirmed);
  const hasSettlement = data.documents.some((doc) => doc.kind === 'settlement' && doc.confirmed);
  const billingFindings = data.findings.filter((item) => item.check !== 'settlement');
  const insuranceFindings = data.findings.filter((item) => item.check === 'settlement');
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
    if (data?.drafts[nextAction]?.revision === revision) {
      setError('');
      setOverlay({ type: 'action', action: nextAction });
      return;
    }
    try {
      await update(`draft-${nextAction}`, '/drafts', { revision, action: nextAction });
      setOverlay({ type: 'action', action: nextAction });
    } catch (cause) { report(cause); }
  }

  async function simulate(step: SimulationStep) {
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
        await apiUrl(`/cases/${id}/packet?revision=${revision}`), filename, { headers: await headers() },
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

  const live = cloudBuild && !data.sample;
  const openEvidence = (entry: EvidenceView) => setOverlay({ type: 'evidence', entry });
  const addEvidence = () => setOverlay({ type: 'intake' });
  return <Screen>
    <View style={[ui.between, styles.toolbar]}>
      <IconButton label="Back to FairBill" icon="arrow-left" onPress={() => { if (!busy) router.back(); }} />
      <View style={ui.grow}>
        <Text style={ui.heading}>{data.sample ? 'Sample investigation' : 'Hospital bill case'}</Text>
        {data.sample && <Text style={ui.kicker}>Fictional case</Text>}
      </View>
      {!hostedBuild && <IconButton label="Add evidence" icon="plus" onPress={() => { if (!busy) addEvidence(); }} />}
    </View>
    <ConnectionStatus problemsOnly />
    <View style={styles.tabs} accessibilityRole="tablist">
      {((ready ? ['Review', 'Documents', 'Timeline', 'Actions'] : ['Review', 'Documents', 'Timeline']) as Tab[]).map((name) => <TouchableRipple key={name} accessibilityRole="tab" accessibilityLabel={name}
        accessibilityState={{ selected: activeTab === name }} onPress={() => setTab(name)}
        style={[styles.tab, name === activeTab && styles.tabActive]}>
        <Text style={[styles.tabLabel, name === activeTab && styles.tabLabelActive]}>{name}</Text>
      </TouchableRipple>)}
    </View>
    <ScrollView key={activeTab} contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
      {error && !overlay ? <Message text={error} onClose={() => setError('')} /> : null}
      {activeTab === 'Review' && <>
        <View style={ui.between}>
          <Text accessibilityRole="header" style={[ui.title, ui.grow]}>Case review</Text>
          <Badge tone="neutral">Revision {revision}</Badge>
        </View>
        {!ready && <><ReviewProgress stage={!hasBill ? 0 : pending ? 1 : 2} /><View style={ui.card}>
          <Text style={ui.label}>{pending ? 'Document needs confirmation' : hasInvoice ? 'Ready to investigate' : 'Add your hospital invoice'}</Text>
          <Text style={ui.body}>{pending ? 'Review the source and confirm the extracted rows.' : hasInvoice
            ? 'Check the confirmed documents for billing questions and insurance deductions.'
            : 'Scan a printed invoice, import a file, or paste the text to start.'}</Text>
          {pending ? <Button label="Review document" icon="arrow-right" onPress={() => setOverlay({ type: 'review', id: pending.id })} />
            : hasInvoice ? <Button label={data.history.length ? 'Re-run investigation' : 'Run investigation'} icon="search"
              busy={busy === 'investigate'} disabled={!!busy} onPress={() => void run()} />
              : <Button label="Add invoice" icon="plus" onPress={addEvidence} />}
        </View></>}
        <ScenarioCard data={data} stale={!ready} onEvidence={openEvidence} />
        {ready && <>
          {canAddOrder && <Card tone="tonal">
            <View style={ui.row}>
              <AppIcon name="file-plus" color={color.primary} size={21} />
              <Text style={[ui.label, ui.grow]}>A second lab order is available</Text>
            </View>
            <Text style={ui.small}>Add it to see how new evidence changes the calculation.</Text>
            <Button label="Add second lab order" icon="plus" tone="ghost" busy={busy === 'sample-order'} disabled={!!busy}
              onPress={() => { void update('sample-order', '/documents/sample-order', { revision }).then(reviewNew).catch(report); }} />
          </Card>}
          <SectionHeader>Billing questions</SectionHeader>
          {billingFindings.map((finding) => <FindingCard key={finding.id} finding={finding}
            onPress={openEvidence} />)}
          {!billingFindings.length && <Text style={ui.body}>No billing questions were flagged in the confirmed lines.</Text>}
          <SectionHeader>Insurance review</SectionHeader>
          {insuranceFindings.map((finding) => <FindingCard key={finding.id} finding={finding}
            onPress={openEvidence} />)}
          {!insuranceFindings.length && <Text style={ui.body}>{hasSettlement
            ? 'No deductions were flagged in the confirmed statement.'
            : 'Add a settlement statement to check deductions.'}</Text>}
          {live && <Button label="Review India price and policy sources" icon="search" tone="light" disabled={!!busy}
            onPress={() => setOverlay({ type: 'india-review' })} />}
          {versioned && <Card tone="tonal">
            <SectionHeader>Help with paying</SectionHeader>
            <Text style={ui.body}>{live ? 'Find the published assistance process and prepare questions for your hospital.'
              : 'Check the fictional assistance policy and see which clauses apply to the example.'}</Text>
            <Button label={live ? 'View assistance resources' : 'Check assistance'} icon="heart" tone="light" disabled={!!busy}
              onPress={() => setOverlay({ type: 'assistance' })} />
          </Card>}
        </>}
      </>}
      {activeTab === 'Actions' && ready && <CaseActions data={data} busy={busy} live={live}
        prepare={(item) => void prepare(item)} preview={() => void previewPacket()} />}
      {activeTab === 'Documents' && <>
        <Text accessibilityRole="header" style={ui.title}>Documents</Text>
        {data.documents.length > 0 ? <Card>
          {data.documents.map((doc, index) => <View key={doc.id}>
            {index > 0 && <Divider />}
            <TouchableRipple accessibilityRole="button" accessibilityLabel={doc.id === 'second-order' ? 'Second lab order' : KINDS[doc.kind]}
              accessibilityHint={doc.confirmed ? 'Confirmed. Opens document lines.' : 'Needs review. Opens document lines.'}
              accessibilityState={{ disabled: !!busy }} disabled={!!busy}
              onPress={() => setOverlay({ type: 'review', id: doc.id })}>
              <View style={[ui.between, styles.documentRow]}>
                <AppIcon name="file-text" size={22} color={color.primary} />
                <View style={ui.grow}>
                  <Text style={ui.label}>{doc.id === 'second-order' ? 'Second lab order' : KINDS[doc.kind]}</Text>
                  <Text style={ui.small}>{doc.rows.length} {doc.rows.length === 1 ? 'line' : 'lines'} · {doc.confirmed ? 'Confirmed' : 'Needs review'}</Text>
                </View>
                <AppIcon name="chevron-right" color={color.muted} size={18} />
              </View>
            </TouchableRipple>
          </View>)}
        </Card> : <EmptyState>No documents in this case yet.</EmptyState>}
        {!hostedBuild && <Button label="Add evidence" icon="plus" onPress={addEvidence} disabled={!!busy} />}
      </>}
      {activeTab === 'Timeline' && <>
        <Text style={ui.title}>Timeline</Text>
        <Timeline data={data} onRevision={(entry) => setOverlay({ type: 'revision', revision: entry })} />
      </>}
    </ScrollView>
    {!hostedBuild && overlay?.type === 'intake' && <Intake busy={!!busy} startKind={hasInvoice ? 'service_record' : 'invoice'} onClose={close}
      onPaste={async (kind: Kind, text: string) => reviewNew(await update('import', '/documents/text', { kind, text, revision }))}
      onFile={async (kind, asset) => {
        reviewNew(await update('import', '/documents/file', documentForm(kind, revision, asset)));
      }} />}
    {reviewing && <Review key={reviewing.id} doc={reviewing} readOnly={hostedBuild} busy={!!busy} onClose={close} onConfirm={confirm}
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
    {live && overlay?.type === 'india-review' && <IndiaReview data={data} initial="tariff" onClose={close} />}
    {overlay?.type === 'assistance' && (live ? <IndiaReview data={data} initial="aid" onClose={close} />
      : <Assistance caseId={id} revision={revision} onClose={close} />)}
    {action && <Outreach action={action} draft={draft} approved={approved} receipt={receipt} busy={busy} live={live}
      error={error} onDismissError={() => setError('')} onClose={close}
      onApprove={() => {
        if (draft) void update('approve', '/approvals', { action, revision, hash: draft.hash }).catch(report);
      }}
      onSimulate={(step) => void simulate(step)}
      onEdit={versioned && !hostedBuild && action === 'letter' ? async (text) => {
        try { await update('edit-letter', '/drafts/letter', { revision, text }, 'PATCH'); }
        catch (cause) { report(cause); throw cause; }
      } : undefined} />}
    {overlay?.type === 'packet' && <Sheet title="Redacted packet" onClose={close}>
      <ScrollView contentContainerStyle={ui.content}>
        <Card tone="tonal">
          <View style={ui.row}>
            <AppIcon name="shield" size={20} color={color.primary} />
            <SectionHeader>Redactions</SectionHeader>
          </View>
          <Text style={ui.body}>{live
            ? 'The packet includes source locations, findings, amounts and revision history. It omits uploaded text and approved letters.'
            : 'The packet retains source locations, findings, amounts and revision history.'}</Text>
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
      </ScrollView>
      <ActionBar>
        <Button label="Share redacted PDF" icon="share-2" busy={busy === 'share'} disabled={!ready || !!busy || !overlay.lines.length} onPress={() => void share()} />
      </ActionBar>
    </Sheet>}
  </Screen>;
}

const styles = StyleSheet.create({
  toolbar: { paddingHorizontal: 20, paddingVertical: 9 },
  progress: { flexDirection: 'row', gap: 8 },
  progressStep: { flex: 1, gap: 6 },
  progressLine: { height: 3, borderRadius: 3, backgroundColor: color.line },
  progressActive: { backgroundColor: color.primary },
  progressLabel: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
  progressCurrent: { color: color.primary },
  progressDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.primary },
  documentRow: { minHeight: 64, paddingVertical: 8 },
  tabs: { flexDirection: 'row', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: color.line },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingVertical: 8,
    paddingHorizontal: 3, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: color.primary },
  tabLabel: { color: color.muted, fontFamily: font.medium, fontSize: 14, lineHeight: 20, letterSpacing: 0.1, textAlign: 'center' },
  tabLabelActive: { color: color.ink },
});
