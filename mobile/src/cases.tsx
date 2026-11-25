import { AppIcon } from './icons';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SegmentedButtons } from 'react-native-paper';
import { Illustration } from './illustrations';
import { cloudBuild } from './cloud-auth';
import { request, type CasePage } from './api';
import { Badge, Button, EmptyState, LoadingState, Message, color, ui } from './ui';

export function CaseList({ onOpen }: { onOpen: (id: string) => void }) {
  const [cases, setCases] = useState<CasePage['cases']>([]);
  const [after, setAfter] = useState<string | null>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

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

  const filtered = cases.filter((item) => filter === 'all'
    || (item.investigated_revision === item.revision) === (filter === 'complete'));

  return <ScrollView style={ui.grow} contentContainerStyle={ui.content}>
      <View style={ui.between}>
        <View style={[ui.grow, ui.stack]}>
          <Text accessibilityRole="header" style={ui.title}>Your cases</Text>
          <Text style={ui.body}>{cloudBuild ? 'Reviews saved to your FairBill account.' : 'Reviews saved to this installation.'}</Text>
        </View>
        <Illustration name="cases" size={58} />
      </View>
      <SegmentedButtons value={filter} onValueChange={setFilter} buttons={[
        { value: 'all', label: 'All' }, { value: 'open', label: 'In review' }, { value: 'complete', label: 'Reviewed' },
      ]} />
      {error ? <><Message text={error} /><Button label="Retry" icon="refresh-cw" onPress={() => void load()} /></> : null}
      {filtered.map((item) => <Pressable key={item.id} accessibilityRole="button"
        onPress={() => onOpen(item.id)} style={({ pressed }) => [ui.card, ui.between, styles.case, pressed && styles.pressed]}>
        <AppIcon name="file-text" size={20} color={color.primary} />
        <View style={ui.grow}>
          <Text style={ui.label}>{item.sample ? 'Sample investigation' : 'Hospital bill case'}</Text>
          <Badge tone={item.investigated_revision === item.revision ? 'green' : 'amber'}>
            {item.investigated_revision === item.revision ? 'Review complete' : 'Needs review'}
          </Badge>
        </View>
        <AppIcon name="chevron-right" size={18} color={color.primary} />
      </Pressable>)}
      {busy ? <LoadingState label="Loading cases" />
        : !error && !filtered.length && <EmptyState>{cases.length
          ? after ? 'No matches on the loaded page. Load more cases to keep looking.' : 'No cases match this filter.'
          : 'Open the sample or create a case to get started.'}</EmptyState>}
      {!busy && !error && after && <Button label="Load more cases" tone="ghost" onPress={() => void load(after)} />}
    </ScrollView>;
}

const styles = StyleSheet.create({ case: { minHeight: 72 }, pressed: { backgroundColor: color.secondaryContainer } });
