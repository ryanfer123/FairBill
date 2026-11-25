import { AppIcon } from './icons';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cloudBuild } from './cloud-auth';
import { request, type CasePage } from './api';
import { Button, Card, EmptyState, LoadingState, Message, Sheet, color, ui } from './ui';

export function CaseList({ onOpen, onClose }: { onOpen: (id: string) => void; onClose: () => void }) {
  const [cases, setCases] = useState<CasePage['cases']>([]);
  const [after, setAfter] = useState<string | null>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (cursor?: string) => {
    setBusy(true);
    setError('');
    try {
      const page = await request<CasePage>(`/cases?limit=20${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`);
      setCases((items) => cursor ? [...items, ...page.cases] : page.cases);
      setAfter(page.next_after);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return <Sheet title="Your cases" onClose={onClose}>
    <ScrollView contentContainerStyle={ui.content}>
      {error ? <><Message text={error} /><Button label="Retry" icon="refresh-cw" onPress={() => void load()} /></> : null}
      {cases.map((item) => <Pressable key={item.id} accessibilityRole="button"
        onPress={() => onOpen(item.id)} style={[ui.card, ui.between, styles.case]}>
        <AppIcon name="file-text" size={20} color={color.primary} />
        <View style={ui.grow}>
          <Text style={ui.label}>{item.sample ? 'Sample investigation' : 'Hospital bill case'}</Text>
          <Text style={ui.small}>Revision {item.revision} · {item.investigated_revision === item.revision ? 'Review complete' : 'Needs review'}</Text>
        </View>
        <AppIcon name="chevron-right" size={18} color={color.primary} />
      </Pressable>)}
      {busy ? <LoadingState label="Loading cases" />
        : !error && !cases.length && <EmptyState>Open the sample or create a case to get started.</EmptyState>}
      {!busy && !error && after && <Button label="Load more cases" tone="ghost" onPress={() => void load(after)} />}
      {!busy && !!cases.length && <Card><Text style={ui.small}>{cloudBuild ? 'Cases saved to your FairBill account.' : 'Cases saved to this installation.'}</Text></Card>}
    </ScrollView>
  </Sheet>;
}

const styles = StyleSheet.create({ case: { minHeight: 64 } });
