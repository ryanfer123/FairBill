import { AppIcon } from '../../src/icons';
import { supportsLocalPacketActions, performPacketAction, type PacketAction } from '../../src/redacted-pdf';
import Animated from 'react-native-reanimated';
import { evidenceReveal } from '../../src/motion';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { TouchableRipple } from 'react-native-paper';
import { EvidenceDocuments } from '../../src/evidence-documents';
import type { ScanStage } from '../../src/scan-preview';
import { Illustration } from '../../src/illustrations';
import { CaseActions } from '../../src/case-actions';
import { CaseAssistant, type AssistantAction, type SavedPlan } from '../../src/case-assistant';
import { Assistance, AssistanceSources } from '../../src/assistance';
import { IndiaReview } from '../../src/india-review';
import { accountUser, cloudBuild } from '../../src/cloud-auth';
import { ConnectionStatus } from '../../src/connection';
import { Action, ApiError, Case, History, KINDS, Kind, Row, Source, getBackend, getCase, hostedBuild, newImportId, postCase, request } from '../../src/api';
import { documentForm, type PickedDocument } from '../../src/document-picker';
import { Intake, Review } from '../../src/intake';
import { Outreach, type SimulationStep } from '../../src/outreach';
import { Evidence, type EvidenceView, FindingCard, ReviewChange, ReviewHeadline, RevisionComparison, ScenarioCard, Timeline, revisionTitle } from '../../src/results';
import { font } from '../../src/typography';
import { ActionBar, Badge, Button, Card, Divider, EmptyState, IconButton, LoadingState, Message, Screen, SectionHeader, Sheet, color, ui } from '../../src/ui';

type EvidenceOverlay = { type: 'evidence'; entry: EvidenceView; returnTo?: History };
type Overlay = { type: 'intake'; kind?: Kind } | { type: 'review'; id: string; rowId?: string; returnTo?: EvidenceOverlay } | EvidenceOverlay
  | { type: 'assistant' } | { type: 'assistance' } | { type: 'india-review' } | { type: 'revision'; revision: History } | { type: 'action'; action: Action } | { type: 'packet'; lines: string[]; revision: number };
type Tab = 'Review' | 'Evidence' | 'Timeline' | 'Act';
const caseID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export default function CaseScreen() {
  const { width, fontScale } = useWindowDimensions();
  const compact = width / fontScale < 335;
  const params = useLocalSearchParams<{ id: string; document?: string; section?: string }>();
  const id = typeof params.id === 'string' && caseID.test(params.id) ? params.id : '';
  const [data, setData] = useState<Case>();
  const [versioned, setVersioned] = useState(false);
  const [indiaReview, setIndiaReview] = useState(false);
  const [busy, setBusy] = useState('');
  const [packetNotice, setPacketNotice] = useState('');
  const working = useRef(false);
  const cancelRequested = useRef(false);
  const uploadControl = useRef<AbortController | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('Review');
  const [overlay, setOverlay] = useState<Overlay>();
  const [assistantPlan, setAssistantPlan] = useState<SavedPlan>();
  const [directed, setDirected] = useState(false);
  const [revealedRevision, setRevealedRevision] = useState<number>();

  useEffect(() => {
    if (!data || directed) return;
    setDirected(true);
    if (params.document && data.documents.some((doc) => doc.id === params.document && !doc.confirmed)) {
      setOverlay({ type: 'review', id: params.document });
    } else if (params.section === 'aid' && versioned && data.investigated_revision === data.revision) {
      setOverlay({ type: 'assistance' });
    } else if (params.section === 'act' && data.investigated_revision === data.revision) {
      setTab('Act');
    }
  }, [data, directed, params.document, params.section, versioned]);

  const refresh = useCallback(async () => {
    setError('');
    if (!id) { setError('This case link is invalid.'); return; }
    try {
      const [snapshot, backend] = await Promise.all([getCase(id), getBackend()]);
      setVersioned(backend.prefix === '/v1');
      setIndiaReview(backend.indiaReview === true);
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
  const canExportPacket = ready && overlay?.type === 'packet' && overlay.revision === revision && overlay.lines.length > 0;
  const canAct = ready && (!cloudBuild || !data.sample);
  const activeTab = !canAct && tab === 'Act' ? 'Review' : tab;
  const pending = data.documents.find((doc) => !doc.confirmed);
  const hasBill = data.documents.some((doc) => doc.kind === 'invoice');
  const hasInvoice = data.documents.some((doc) => doc.kind === 'invoice' && doc.confirmed);
  const hasSettlement = data.documents.some((doc) => doc.kind === 'settlement' && doc.confirmed);
  const billingFindings = data.findings.filter((item) => item.check !== 'settlement');
  const insuranceFindings = data.findings.filter((item) => item.check === 'settlement');
  const canAddOrder = !cloudBuild && data.sample && !data.documents.some((doc) => doc.id === 'second-order');
  const reviewing = overlay?.type === 'review' ? data.documents.find((doc) => doc.id === overlay.id) : undefined;
  const action = overlay?.type === 'action' ? overlay.action : null;
  const draft = action ? data.drafts[action] : undefined;
  const approved = !!draft && data.approvals[draft.action]?.hash === draft.hash;
  const receipt = draft ? data.receipts[`${draft.revision}:${draft.action}:${draft.hash}`] : undefined;

  async function run() {
    try {
      const next = await update('investigate', '/investigate', { revision });
      setRevealedRevision(next.revision);
      setTab('Review');
    } catch (cause) { report(cause); }
  }

  function reviewNew(next: Case) {
    const doc = next.documents.at(-1);
    if (doc) setOverlay({ type: 'review', id: doc.id });
  }

  async function importEvidence(kind: Kind, source: string | PickedDocument, onStage?: (stage: ScanStage) => void) {
    if (working.current) return;
    working.current = true;
    cancelRequested.current = false;
    setDiscarding(false);
    setBusy('import');
    const importId = newImportId();
    let submitted = false;
    try {
      const form = typeof source === 'string' ? undefined : await documentForm(kind, revision, source, () => onStage?.('reading'));
      if (cancelRequested.current) return;
      if (form) onStage?.('processing');
      submitted = true;
      uploadControl.current = new AbortController();
      const signal = uploadControl.current.signal;
      const result = form
        ? await postCase(`/cases/${id}/documents/file`, form, importId, signal)
        : await postCase(`/cases/${id}/documents/text`, { kind, revision, text: source }, importId, signal);
      if (!cancelRequested.current) {
        setData(result);
        reviewNew(result);
      }
    } catch (cause) {
      if (!cancelRequested.current) {
        if (cause instanceof ApiError && cause.status === 409) await refresh();
        throw cause;
      }
    } finally {
      try {
        if (cancelRequested.current) {
          if (submitted) {
            const current = await postCase(`/cases/${id}/imports/${importId}/cancel`, { revision });
            setData(current);
          }
          setOverlay(undefined);
        }
      } catch {
        await refresh();
        throw new Error('Could not confirm discard. Check Evidence for the pending document before trying again.');
      } finally {
        uploadControl.current = null;
        setBusy('');
        setDiscarding(false);
        working.current = false;
      }
    }
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

  async function handlePacket(action: PacketAction) {
    if (working.current || !canExportPacket || overlay?.type !== 'packet') return;
    working.current = true;
    setBusy(action);
    setError('');
    setPacketNotice('');
    try {
      const saved = await performPacketAction(id, overlay.revision, action);
      if (saved) setPacketNotice('PDF saved to the selected location.');
    } catch (cause) { report(cause); }
    finally { setBusy(''); working.current = false; }
  }

  async function previewPacket() {
    if (working.current) return;
    working.current = true;
    setBusy('preview');
    setError('');
    setPacketNotice('');
    try {
      const result = await request<{ lines: string[] }>(`/cases/${id}/packet?revision=${revision}&preview=true`);
      setOverlay({ type: 'packet', lines: result.lines, revision });
    } catch (cause) {
      report(cause);
    } finally {
      setBusy('');
      working.current = false;
    }
  }

  const live = cloudBuild && !data.sample;
  const canAddEvidence = !hostedBuild && !(cloudBuild && data.sample);
  const sourceDocument = (source: Source) => data.documents.find((doc) => doc.id === source.document_id
    && doc.sha256 === source.sha256 && doc.rows.some((row) =>
      row.id === source.row_id && row.page === source.page && row.line === source.line));
  const openEvidence = (entry: EvidenceView) => setOverlay({ type: 'evidence', entry });
  const preferredEvidence = accountUser()?.user_metadata?.preferred_evidence;
  const addEvidence = () => setOverlay({ type: 'intake', kind: hasInvoice &&
    (preferredEvidence === 'settlement' || preferredEvidence === 'policy') ? preferredEvidence : undefined });
  const showAssistant = () => {
    if (!working.current) setOverlay({ type: 'assistant' });
  };
  const takeAssistantAction = (item: AssistantAction) => {
    if (working.current) return;
    setError('');
    switch (item.type) {
      case 'intake': setOverlay({ type: 'intake', kind: item.kind }); break;
      case 'document': setOverlay({ type: 'review', id: item.id }); break;
      case 'evidence': setOverlay(undefined); setTab('Evidence'); break;
      case 'result': setOverlay(undefined); setTab('Review'); break;
      case 'investigate': setOverlay(undefined); void run(); break;
      case 'prepare': setOverlay(undefined); void prepare(item.action); break;
      case 'packet': setOverlay(undefined); void previewPacket(); break;
      case 'assistance': setOverlay({ type: 'assistance' }); break;
      case 'india-review': setOverlay({ type: 'india-review' }); break;
    }
  };
  return <Screen>
    <View style={[ui.between, styles.toolbar]}>
      <IconButton label="Back to FairBill" icon="arrow-left" onPress={() => { if (!busy) router.back(); }} />
      <Text accessibilityRole="header" style={[ui.label, ui.grow]}>{data.sample ? 'Sample case' : 'Hospital bill'}</Text>
      <IconButton label="Case assistant" icon="message-circle" onPress={showAssistant} />
      {canAddEvidence && !compact && <Button label="Add evidence" icon="plus" tone="ghost" disabled={!!busy} onPress={addEvidence} />}
    </View>
    <ConnectionStatus problemsOnly />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}
      contentContainerStyle={styles.tabs} accessibilityRole="tablist">
      {((canAct ? ['Review', 'Evidence', 'Timeline', 'Act'] : ['Review', 'Evidence', 'Timeline']) as Tab[]).map((name) => <TouchableRipple key={name} accessibilityRole="tab" accessibilityLabel={name}
        accessibilityState={{ selected: activeTab === name }} onPress={() => { setRevealedRevision(undefined); setTab(name); }}
        style={[styles.tab, compact && styles.compactTab, name === activeTab && styles.tabActive]}>
        <Text style={[styles.tabLabel, name === activeTab && styles.tabLabelActive]}>{name}</Text>
      </TouchableRipple>)}
    </ScrollView>
    <ScrollView key={activeTab === 'Review' ? `review-${revision}` : activeTab} contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
      {error && !overlay ? <Message text={error} onClose={() => setError('')} /> : null}
      {activeTab === 'Review' && <>
        {ready ? <ReviewHeadline data={data} animate={revealedRevision === revision} /> : <>
          <Text accessibilityRole="header" style={ui.title}>Case review</Text>
          <View style={ui.card}>
            <Text style={ui.label}>{pending ? 'Document needs confirmation' : hasInvoice ? 'Ready to investigate' : 'Add your hospital invoice'}</Text>
            <Text style={ui.body}>{pending ? 'Review the source and confirm the extracted rows.' : hasInvoice
              ? 'Check the confirmed documents for billing questions and insurance deductions.'
              : 'Scan a printed invoice, import a file, or paste the text to start.'}</Text>
            {pending ? <Button label="Review document" icon="arrow-right" disabled={!!busy}
                onPress={() => setOverlay({ type: 'review', id: pending.id })} />
              : hasInvoice ? <Button label={data.history.length ? 'Re-run investigation' : 'Run investigation'} icon="search"
                busy={busy === 'investigate'} disabled={!!busy} onPress={() => void run()} />
                : canAddEvidence && <Button label="Add invoice" icon="plus" onPress={addEvidence} />}
          </View>
        </>}
        {ready && <ReviewChange data={data} onEvidence={openEvidence} />}
        <ScenarioCard data={data} stale={!ready} onEvidence={openEvidence} />
        {ready && <>
          <SectionHeader>Questions to ask billing</SectionHeader>
          {billingFindings.filter((finding) => finding.status !== 'withdrawn').map((finding) => <FindingCard key={finding.id} finding={finding} onPress={openEvidence} />)}
          {!billingFindings.some((finding) => finding.status === 'active') &&
            <Text style={ui.body}>No open billing questions in the confirmed lines.</Text>}
          {billingFindings.filter((finding) => finding.status === 'withdrawn').map((finding) =>
            <FindingCard key={finding.id} finding={finding} onPress={openEvidence} />)}
        </>}
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
          <SectionHeader>Insurance review</SectionHeader>
          {insuranceFindings.map((finding) => <FindingCard key={finding.id} finding={finding}
            onPress={openEvidence} />)}
          {!insuranceFindings.length && <Text style={ui.body}>{hasSettlement
            ? 'No deductions were flagged in the confirmed statement.'
            : 'Add a settlement statement to check deductions.'}</Text>}
          {live && indiaReview && <Button label="Review India price and policy sources" icon="search" tone="light" disabled={!!busy}
            onPress={() => setOverlay({ type: 'india-review' })} />}
          {versioned && (!cloudBuild || !data.sample) && <Card tone="tonal">
            <SectionHeader>Help with paying</SectionHeader>
            <Text style={ui.body}>{live ? 'Find the published assistance process and prepare questions for your hospital.'
              : 'Check the fictional assistance policy and see which clauses apply to the example.'}</Text>
            <Button label={live ? 'View assistance resources' : 'Check assistance'} icon="heart" tone="light" disabled={!!busy}
              onPress={() => setOverlay({ type: 'assistance' })} />
          </Card>}
        </>}
      </>}
      {activeTab === 'Act' && canAct && <CaseActions data={data} busy={busy} live={live}
        prepare={(item) => void prepare(item)} preview={() => void previewPacket()} />}
      {activeTab === 'Evidence' && <>
        <Text accessibilityRole="header" style={ui.title}>Evidence</Text>
        <EvidenceDocuments data={data} busy={!!busy} onOpen={(documentId, rowId) =>
          setOverlay({ type: 'review', id: documentId, rowId })} />
        {canAddEvidence && <Button label="Add evidence" icon="plus" onPress={addEvidence} disabled={!!busy} />}
      </>}
      {activeTab === 'Timeline' && <>
        <View style={ui.between}><Text accessibilityRole="header" style={ui.title}>Timeline</Text><Illustration name="history" /></View>
        <Timeline data={data} onRevision={(entry) => setOverlay({ type: 'revision', revision: entry })} />
      </>}
    </ScrollView>
    {overlay?.type === 'assistant' && <CaseAssistant data={data} busy={!!busy} canAct={canAct}
      canAddEvidence={canAddEvidence} canReviewDocuments={!hostedBuild && !(cloudBuild && data.sample)}
      supportsAssistance={versioned && (!cloudBuild || !data.sample)} supportsIndia={live && indiaReview}
      live={live} savedPlan={assistantPlan} onPlan={setAssistantPlan} onAction={takeAssistantAction} onClose={close} />}
    {canAddEvidence && overlay?.type === 'intake' && <Intake busy={!!busy} startKind={overlay.kind ?? (hasInvoice ? 'service_record' : 'invoice')} onClose={close}
      discarding={discarding} onDiscard={() => { cancelRequested.current = true; uploadControl.current?.abort(); setDiscarding(true); }}
      onPaste={importEvidence} onFile={importEvidence} />}
    {reviewing && overlay?.type === 'review' && <Review key={reviewing.id} doc={reviewing}
      initialRowId={overlay.rowId} readOnly={hostedBuild || !!overlay.returnTo || (cloudBuild && data.sample)} busy={!!busy}
      onClose={() => { if (overlay.returnTo) setOverlay(overlay.returnTo); else close(); }} onConfirm={confirm}
      onDiscard={async () => {
        await update('discard', `/documents/${reviewing.id}/discard`, { revision });
        setOverlay(undefined);
      }} />}
    {overlay?.type === 'evidence' && <Evidence entry={overlay.entry} onSource={(source) => {
      const doc = sourceDocument(source);
      if (doc) setOverlay({ type: 'review', id: doc.id, rowId: source.row_id, returnTo: overlay });
    }} canOpenSource={(source) => !!sourceDocument(source)} onClose={() => {
      if (overlay.returnTo) setOverlay({ type: 'revision', revision: overlay.returnTo });
      else close();
    }} />}
    {overlay?.type === 'revision' && <Sheet title={revisionTitle(data, overlay.revision)} onClose={close}>
      <ScrollView contentContainerStyle={ui.content}>
        <RevisionComparison data={data} item={overlay.revision} />
        {overlay.revision.findings.map((finding) => <FindingCard key={finding.id} finding={finding}
          onPress={(entry) => setOverlay({ type: 'evidence', entry, returnTo: overlay.revision })} />)}
      </ScrollView>
    </Sheet>}
    {live && overlay?.type === 'india-review' && <IndiaReview data={data} initial="tariff" onClose={close} />}
    {overlay?.type === 'assistance' && (live ? (indiaReview ? <IndiaReview data={data} initial="aid" onClose={close} />
      : <AssistanceSources onClose={close} />)
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
        <Animated.View entering={evidenceReveal}>
          <Card tone="tonal">
            <View style={ui.row}>
              <Illustration name="packet" size={48} />
              <View style={ui.grow}><SectionHeader>What’s in the PDF</SectionHeader></View>
            </View>
            <Text style={ui.body}>{live
              ? 'Findings, amounts, source locations and revision history. Uploaded text and approved letters are omitted.'
              : 'Findings, amounts, source locations and revision history.'}</Text>
          </Card>
        </Animated.View>
        {error ? <Message text={error} /> : null}
        {overlay.lines.length ? <Card>
          <SectionHeader>{overlay.lines[0]}</SectionHeader>
          {overlay.lines.slice(1).join('\n').split(/\n{2,}/).filter((section) => section.trim()).map((section, index) =>
            <View key={index} style={ui.stack}>
              <Divider />
              <Text selectable style={[ui.body, styles.paperCopy]}>{section}</Text>
            </View>
          )}
        </Card> : <EmptyState>The preview is empty. Close this view and try again.</EmptyState>}
      </ScrollView>
      <ActionBar>
        {!!packetNotice && <Text accessibilityLiveRegion="polite" style={[ui.small, styles.packetNotice]}>{packetNotice}</Text>}
        {supportsLocalPacketActions && <Button label="Open PDF" icon="file-text" busy={busy === 'open'}
          disabled={!canExportPacket || !!busy} onPress={() => void handlePacket('open')} />}
        <View style={supportsLocalPacketActions && !compact ? ui.row : ui.stack}>
          {supportsLocalPacketActions && <View style={!compact && ui.grow}>
            <Button label="Save a copy" icon="download" tone="light" busy={busy === 'save'}
              disabled={!canExportPacket || !!busy} onPress={() => void handlePacket('save')} />
          </View>}
          <View style={supportsLocalPacketActions && !compact && ui.grow}>
            <Button label={supportsLocalPacketActions ? 'Share PDF' : 'Share redacted PDF'} icon="share-2"
              tone={supportsLocalPacketActions ? 'ghost' : 'primary'} busy={busy === 'share'}
              disabled={!canExportPacket || !!busy} onPress={() => void handlePacket('share')} />
          </View>
        </View>
      </ActionBar>
    </Sheet>}
  </Screen>;
}

const styles = StyleSheet.create({
  toolbar: { paddingHorizontal: 16, paddingVertical: 6, gap: 8 },
  paperCopy: { color: color.ink },
  packetNotice: { color: color.primary },
  tabBar: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: color.line },
  tabs: { flexGrow: 1, flexDirection: 'row', paddingHorizontal: 8 },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingVertical: 8,
    paddingHorizontal: 3, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  compactTab: { flexGrow: 1, flexShrink: 0, flexBasis: 'auto', paddingHorizontal: 12 },
  tabActive: { borderBottomColor: color.primary },
  tabLabel: { color: color.muted, fontFamily: font.medium, fontSize: 14, lineHeight: 20, letterSpacing: 0.1, textAlign: 'center' },
  tabLabelActive: { color: color.ink },
});
