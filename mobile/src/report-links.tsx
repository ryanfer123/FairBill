import { useEffect, useRef, useState } from 'react';
import { Share, Text, View } from 'react-native';
import { Checkbox, RadioButton } from 'react-native-paper';
import { getBackend, request } from './api';
import type { components } from './generated/fairbill-v1';
import { useFairBillTheme } from './theme';
import { Badge, Button, Card, LoadingState, Message, SectionHeader } from './ui';

type Link = components['schemas']['ReportLink'];
type Created = components['schemas']['CreatedReportLink'];
const durations = [{ label: '1 hour', value: '1' }, { label: '24 hours', value: '24' }, { label: '7 days', value: '168' }];

export function ReportLinks({ caseId, revision }: { caseId: string; revision: number }) {
  const { ui } = useFairBillTheme();
  const path = `/cases/${caseId}/report-links`;
  const [links, setLinks] = useState<Link[]>();
  const [error, setError] = useState('');
  const [hours, setHours] = useState('24');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ id: string; url: string }>();
  const [pendingRevoke, setPendingRevoke] = useState<string>();
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    const control = new AbortController();
    void request<Link[]>(path, { signal: control.signal }).then((value) => {
      if (!control.signal.aborted) setLinks(value);
    }).catch(() => {
      if (!control.signal.aborted) setError('Report links couldn’t load.');
    });
    return () => { control.abort(); active.current?.abort(); };
  }, [path]);

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const control = new AbortController();
    active.current = control;
    setBusy(true);
    setError('');
    try { await action(control.signal); }
    catch (cause) {
      if (!control.signal.aborted) setError((cause as Error).message);
    } finally {
      active.current = null;
      if (!control.signal.aborted) setBusy(false);
    }
  }

  function create() {
    if (!consent) return;
    void run(async (signal) => {
      const backend = await getBackend();
      try {
        const issuedLink = await request<Created>(path, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision, hours: Number(hours), consent: true }), signal,
        });
        if (signal.aborted) return;
        setIssued({ id: issuedLink.link.id, url: `${backend.origin}/shared-report#${issuedLink.token}` });
        setLinks((previous) => [issuedLink.link, ...(previous ?? [])]);
        setConsent(false);
      } catch (cause) {
        if (!signal.aborted) {
          const current = await request<Link[]>(path, { signal }).catch(() => undefined);
          if (!signal.aborted && current) setLinks(current);
        }
        throw cause;
      }
    });
  }

  function revoke(id: string) {
    void run(async (signal) => {
      await request(`${path}/${id}`, { method: 'DELETE', signal });
      if (signal.aborted) return;
      setLinks((previous) => previous?.map((link) => link.id === id ? { ...link, status: 'revoked' } : link));
      setPendingRevoke(undefined);
      if (issued?.id === id) setIssued(undefined);
    });
  }

  return <Card>
    <SectionHeader>Share by link</SectionHeader>
    <Text style={ui.body}>Anyone with the link can download this redacted packet until it expires or you revoke it. Copies already downloaded stay with the recipient.</Text>
    {!links && !error && <LoadingState label="Loading report links" />}
    {error ? <Message text={error} /> : null}
    {links && <>
      <Text style={ui.label}>Link expires after</Text>
      <RadioButton.Group value={hours} onValueChange={setHours}>
        {durations.map(({ value, label }) => <RadioButton.Item key={value} label={label} value={value} disabled={busy} />)}
      </RadioButton.Group>
      <Checkbox.Item label={`I agree to share the redacted packet for revision ${revision} by link.`}
        status={consent ? 'checked' : 'unchecked'} onPress={() => setConsent(!consent)} disabled={busy} />
      <Button label="Create report link" icon="share-2" onPress={create} busy={busy} disabled={!consent} />
      {issued && <Button label="Open sharing menu" tone="light" icon="share-2" disabled={busy}
        onPress={() => void Share.share({ message: issued.url }).catch(() => setError('Could not open the sharing menu.'))} />}
      {links.length > 0 && <SectionHeader>Manage links</SectionHeader>}
      {links.map((link) => <View key={link.id} style={ui.stack}>
        <Badge tone={link.status === 'active' ? 'green' : 'neutral'}>{link.status}</Badge>
        <Text style={ui.small}>Revision {link.revision} · Expires {new Date(link.expires_at).toLocaleString()}</Text>
        {link.status === 'active' && (pendingRevoke === link.id ? <>
          <Text style={ui.body}>Stop new downloads through this link?</Text>
          <Button label="Revoke link" tone="destructive" disabled={busy} onPress={() => revoke(link.id)} />
          <Button label="Keep link" tone="ghost" disabled={busy} onPress={() => setPendingRevoke(undefined)} />
        </> : <Button label="Revoke access" tone="ghost" disabled={busy} onPress={() => setPendingRevoke(link.id)} />)}
      </View>)}
    </>}
  </Card>;
}
