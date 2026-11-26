import { AppIcon } from './icons';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewProps } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { TouchableRipple } from 'react-native-paper';
import { CaseTray } from './case-tray';
import { cloudBuild } from './cloud-auth';
import { deleteCase, request, type CasePage } from './api';
import { font } from './typography';
import { surfaceReveal } from './motion';
import { Button, LoadingState, Message, IconButton, color, ui } from './ui';

const enterShelf = FadeInDown.withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] }).duration(210).reduceMotion(ReduceMotion.System);

export function CaseList({ onStart, onOpen, onScroll, clearance, onDeleted }: { onStart: () => void; onDeleted: (id: string) => void; onScroll: ScrollViewProps['onScroll']; clearance: number; onOpen: (id: string) => void }) {
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

  function confirmDelete(id: string) {
    Alert.alert(`Delete case ${id.slice(-6).toUpperCase()}?`, 'This permanently removes the bill, uploaded documents and review history.', [
      { text: 'Keep case', style: 'cancel' },
      { text: 'Delete case', style: 'destructive', onPress: async () => {
        setBusy(true);
        setError('');
        try {
          await deleteCase(id);
          setCases(items => items.filter(item => item.id !== id));
          onDeleted(id);
        } catch (cause) { setError((cause as Error).message); }
        finally { setBusy(false); }
      } },
    ]);
  }

  const filtered = cases.filter((item) => filter === 'all'
    || (item.investigated_revision === item.revision) === (filter === 'complete'));

  const inReview = cases.filter(item => item.investigated_revision !== item.revision).length;
  return <ScrollView style={ui.grow} onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={[ui.content, { paddingBottom: clearance }]}>
    <Animated.View entering={enterShelf} style={styles.cover}>
      <View style={ui.between}>
        <View style={ui.grow}>
          <Text accessibilityRole="header" style={styles.title}>Your cases</Text>
          <Text style={styles.subtitle}>{cloudBuild ? 'Bill reviews in your account' : 'Bill reviews on this device'}</Text>
        </View>
        <AppIcon name="folder" selected size={42} color={color.primaryContainer} />
      </View>
    </Animated.View>
    <View style={styles.filters}>
      {([{ key: 'all', label: 'All' }, { key: 'open', label: 'In review' }, { key: 'complete', label: 'Reviewed' }] as const).map(tab => {
        const selected = filter === tab.key;
        const count = tab.key === 'all' ? cases.length : tab.key === 'open' ? inReview : cases.length - inReview;
        return <Pressable key={tab.key} accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected }}
          onPress={() => setFilter(tab.key)} style={[styles.filter, selected && styles.selectedFilter]}>
          <Text style={[styles.filterLabel, selected && styles.activeLabel]}>{tab.label}</Text>
          {!busy && !error && !after && <Text style={[styles.tally, selected && styles.activeLabel]}>{count}</Text>}
        </Pressable>;
      })}
    </View>
    {error ? <><Message text={error} /><Button label="Retry" icon="refresh-cw" onPress={() => void load(after || undefined)} /></> : null}
    <Animated.View key={filter} entering={surfaceReveal} style={styles.shelf}>
      {filtered.map(item => {
        const reviewed = item.investigated_revision === item.revision;
        const reference = item.id.slice(-6).toUpperCase();
        const title = item.sample ? 'Sample investigation' : 'Hospital bill';
        const status = reviewed ? 'Reviewed' : 'In review';
        return <View key={item.id} style={[styles.card, ui.row]}><TouchableRipple accessibilityRole="button" accessibilityLabel={`${title}, case ${reference}, ${status}`}
          disabled={busy} onPress={() => onOpen(item.id)} style={ui.grow}>
          <View style={styles.file}>
            <View style={[styles.spine, reviewed && styles.finishedSpine]} />
            <View style={[styles.stamp, !reviewed && styles.openStamp]}>
              <AppIcon name={reviewed ? 'shield' : 'receipt'} size={25} color={reviewed ? color.primary : color.question} />
            </View>
            <View style={ui.grow}>
              <Text style={styles.reference}>CASE {reference}</Text>
              <Text style={styles.fileTitle}>{title}</Text>
              <Text style={[styles.status, reviewed && styles.finishedText]}>{status}</Text>
            </View>
            <AppIcon name="chevron-right" size={18} color={color.muted} />
          </View>
        </TouchableRipple>
          {!busy && <IconButton label={`Delete case ${reference}`} icon="trash-2" onPress={() => confirmDelete(item.id)} />}
        </View>;
      })}
      {!busy && !error && !filtered.length && <View style={styles.empty}>
        <CaseTray />
        <Text style={ui.heading}>{!cases.length ? 'No cases yet' : filter === 'complete' ? 'No reviewed cases here' : 'No cases in review here'}</Text>
        <Text style={[ui.body, styles.center]}>{!cases.length ? 'Your saved hospital bills will appear here.'
          : after ? 'Load more cases to check the next page.' : 'Change the filter to see your other bills.'}</Text>
        {!cases.length && <Button label="Start a bill review" onPress={onStart} />}
      </View>}
    </Animated.View>
    {busy && <LoadingState label="Loading cases" />}
    {!busy && !error && after && <Button label="Load more cases" tone="ghost" onPress={() => void load(after)} />}
  </ScrollView>;
}

const styles = StyleSheet.create({
  cover: { padding: 20, borderRadius: 24, backgroundColor: color.primary, gap: 18 },
  title: { color: color.paper, fontFamily: font.display, fontSize: 40, lineHeight: 44 },
  subtitle: { color: color.primaryContainer, fontFamily: font.regular, fontSize: 16, marginTop: 4 },
  filters: { flexDirection: 'row', borderBottomWidth: 1, borderColor: color.line },
  filter: { flex: 1, minHeight: 48, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', alignContent: 'center', justifyContent: 'center', gap: 5, paddingVertical: 6, borderBottomWidth: 3, borderColor: 'transparent' },
  selectedFilter: { borderColor: color.primary },
  filterLabel: { fontFamily: font.semibold, color: color.muted, fontSize: 15 },
  tally: { fontFamily: font.mono, fontSize: 12, color: color.muted },
  activeLabel: { color: color.primary },
  stamp: { width: 45, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: color.primaryContainer },
  openStamp: { backgroundColor: color.tertiaryContainer },
  shelf: { gap: 10 },
  card: { backgroundColor: color.card, borderWidth: 1, borderColor: color.line, borderRadius: 17, overflow: 'hidden' },
  file: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  spine: { position: 'absolute', left: 0, top: 14, bottom: 14, width: 3, borderRadius: 2, backgroundColor: color.question },
  finishedSpine: { backgroundColor: color.primary },
  reference: { color: color.muted, fontFamily: font.mono, fontSize: 12, letterSpacing: 0.5 },
  fileTitle: { color: color.ink, fontFamily: font.display, fontSize: 24, lineHeight: 29 },
  status: { color: color.question, fontFamily: font.semibold, fontSize: 14 },
  finishedText: { color: color.primary },
  empty: { alignItems: 'center', padding: 22, gap: 10 },
  center: { textAlign: 'center' },
});
