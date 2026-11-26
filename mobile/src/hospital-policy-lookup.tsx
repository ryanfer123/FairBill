import { useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { RadioButton } from 'react-native-paper';
import { ApiError, request } from './api';
import type { components } from './generated/fairbill-v1';
import { useFairBillTheme } from './theme';
import { Badge, Button, Card, LoadingState, Message, SectionHeader } from './ui';

type Source = components['schemas']['PolicySource'];
type Result = components['schemas']['PolicyLookup'];

const statusCopy = {
  verified: 'Excerpt verified',
  failed: 'Source could not be checked',
  unsupported: 'Hospital not covered',
  stale: 'Published excerpt needs review',
} as const;

export function HospitalPolicyLookup({ caseId, revision, onRefreshCase }:
  { caseId: string; revision: number; onRefreshCase: () => void }) {
  const { ui } = useFairBillTheme();
  const [sources, setSources] = useState<Source[]>();
  const [catalogError, setCatalogError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hospital, setHospital] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const activeLookup = useRef<AbortController | null>(null);

  useEffect(() => {
    const control = new AbortController();
    void request<Source[]>('/assistance/policy-sources', { signal: control.signal }).then((catalog) => {
      if (!control.signal.aborted) setSources(catalog);
    }).catch(() => {
      if (!control.signal.aborted) setCatalogError(true);
    });
    return () => control.abort();
  }, [attempt]);
  useEffect(() => () => activeLookup.current?.abort(), []);

  async function check() {
    if (!hospital || activeLookup.current || needsRefresh) return;
    const control = new AbortController();
    activeLookup.current = control;
    setBusy(true);
    setError('');
    setResult(undefined);
    try {
      const value = await request<Result>(`/cases/${caseId}/assistance/policy-lookup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hospital, revision }), signal: control.signal,
      });
      if (control.signal.aborted) return;
      if (value.revision === revision) setResult(value);
      else setNeedsRefresh(true);
    } catch (cause) {
      if (!control.signal.aborted) {
        if (cause instanceof ApiError && cause.status === 409) setNeedsRefresh(true);
        else setError((cause as Error).message);
      }
    } finally {
      activeLookup.current = null;
      if (!control.signal.aborted) setBusy(false);
    }
  }

  return <View style={ui.stack}>
    <Card>
      <SectionHeader>Check your hospital’s assistance page</SectionHeader>
      <Text style={ui.body}>Choose your hospital and campus. FairBill reads its public page without sending your bill or personal details.</Text>
      {catalogError ? <>
        <Message text="The hospital list couldn’t load." />
        <Button label="Retry loading hospitals" tone="ghost" onPress={() => {
          setCatalogError(false);
          setAttempt((previous) => previous + 1);
        }} />
      </> : !sources ? <LoadingState label="Loading supported hospitals" /> : <>
        <RadioButton.Group value={hospital} onValueChange={(value) => {
          setHospital(value);
          setResult(undefined);
          setError('');
        }}>
          {sources.map((source) => <RadioButton.Item key={source.id} value={source.id}
            label={source.hospital} disabled={busy} labelStyle={ui.label} />)}
          <RadioButton.Item value="other" label="My hospital isn’t listed" disabled={busy} labelStyle={ui.label} />
        </RadioButton.Group>
        {needsRefresh ? <>
          <Text style={ui.body}>This case changed. Reload it before checking again.</Text>
          <Button label="Reload case" icon="refresh-cw" onPress={() => onRefreshCase()} />
        </> : <Button label={busy ? 'Checking official page' : 'Check official page'} icon="search"
          disabled={!hospital} busy={busy} onPress={() => void check()} />}
      </>}
      {error ? <Message text={error} /> : null}
    </Card>
    {result && <Card>
      <View accessibilityLiveRegion="polite" style={ui.stack}>
        <Badge tone={result.status === 'verified' ? 'green' : 'amber'}>{statusCopy[result.status]}</Badge>
        {result.source && <SectionHeader>{result.source.hospital}</SectionHeader>}
        {result.status === 'verified' && result.source && result.excerpt && <>
          <Text selectable style={ui.body}>“{result.excerpt}”</Text>
          <Text style={ui.small}>{result.source.title} · {result.source.section}</Text>
          <Text style={ui.body}>{result.source.next_step}</Text>
          <Text style={ui.small}>The hospital determines eligibility.</Text>
        </>}
        {result.status === 'failed' && <Text style={ui.body}>Try again or open the registered page directly.</Text>}
        {result.status === 'stale' && <Text style={ui.body}>The current page no longer matches the reviewed excerpt. Open the page for the latest wording.</Text>}
        {result.status === 'unsupported' && <Text style={ui.body}>Ask your hospital’s billing or medical social work office about its assistance process.</Text>}
        {result.source && <Text style={ui.small}>Checked {new Date(result.checked_at).toLocaleString()}</Text>}
      </View>
      {result.source && <Button label="Open official hospital page" icon="external-link" tone="ghost" onPress={() => {
        const source = result.source;
        if (source) void Linking.openURL(source.url).catch(() => setError('Could not open the hospital page.'));
      }} />}
    </Card>}
  </View>;
}
