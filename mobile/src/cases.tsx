import { AppIcon } from './icons';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type ScrollViewProps } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { SegmentedButtons, TouchableRipple } from 'react-native-paper';
import { Illustration } from './illustrations';
import { cloudBuild } from './cloud-auth';
import { request, type CasePage } from './api';
import { font } from './typography';
import { surfaceReveal } from './motion';
import { Button, LoadingState, Message, color, ui } from './ui';

const enterShelf = FadeInDown.withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] }).duration(210).reduceMotion(ReduceMotion.System);

export function CaseList({ onOpen, onScroll, clearance }: { onScroll: ScrollViewProps['onScroll']; clearance: number; onOpen: (id: string) => void }) {
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

  const inReview = cases.filter(item => item.investigated_revision !== item.revision).length;
  return <ScrollView style={ui.grow} onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={[ui.content, { paddingBottom: clearance }]}>
    <Animated.View entering={enterShelf} style={styles.cover}>
      <View style={ui.between}>
        <View style={ui.grow}>
          <Text accessibilityRole="header" style={styles.title}>Your cases</Text>
          <Text style={styles.subtitle}>{cloudBuild ? 'Bill reviews in your account' : 'Bill reviews on this device'}</Text>
        </View>
        <Illustration name="cases" size={72} />
      </View>
      {cases.length > 0 && <View style={styles.summary}>
        <Text style={styles.count}>{inReview} in review</Text>
        <Text style={styles.count}>{cases.length - inReview} reviewed</Text>
        {!!after && <Text style={styles.scope}>On loaded pages</Text>}
      </View>}
    </Animated.View>
    <SegmentedButtons value={filter} onValueChange={setFilter} buttons={[
      { value: 'all', label: 'All' }, { value: 'open', label: 'In review' }, { value: 'complete', label: 'Reviewed' },
    ]} />
    {error ? <><Message text={error} /><Button label="Retry" icon="refresh-cw" onPress={() => void load(after || undefined)} /></> : null}
    <Animated.View key={filter} entering={surfaceReveal} style={styles.shelf}>
      {filtered.map(item => {
        const reviewed = item.investigated_revision === item.revision;
        const reference = item.id.slice(-6).toUpperCase();
        const title = item.sample ? 'Sample investigation' : 'Hospital bill';
        const status = reviewed ? 'Reviewed' : 'In review';
        return <TouchableRipple key={item.id} accessibilityRole="button" accessibilityLabel={`${title}, case ${reference}, ${status}`}
          onPress={() => onOpen(item.id)} style={styles.card}>
          <View style={styles.file}>
            <View style={[styles.spine, reviewed && styles.finishedSpine]} />
            <Illustration name={reviewed ? 'corrected' : 'confirm'} size={49} />
            <View style={ui.grow}>
              <Text style={styles.reference}>CASE {reference}</Text>
              <Text style={styles.fileTitle}>{title}</Text>
              <Text style={[styles.status, reviewed && styles.finishedText]}>{status}</Text>
            </View>
            <AppIcon name="chevron-right" size={18} color={color.muted} />
          </View>
        </TouchableRipple>;
      })}
      {!busy && !error && !filtered.length && <View style={styles.empty}>
        <Illustration name={filter === 'complete' ? 'corrected' : 'cases'} size={64} />
        <Text style={ui.heading}>{!cases.length ? 'No cases yet' : filter === 'complete' ? 'No reviewed cases here' : 'No cases in review here'}</Text>
        <Text style={[ui.body, styles.center]}>{!cases.length ? 'Add a bill from New check to start your first review.'
          : after ? 'Load more cases to check the next page.' : 'Choose All to see your saved cases.'}</Text>
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
  summary: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.inversePrimary, paddingTop: 13, flexDirection: 'row', flexWrap: 'wrap', columnGap: 20, rowGap: 5 },
  count: { color: color.paper, fontFamily: font.semibold, fontSize: 16 },
  scope: { color: color.primaryContainer, fontFamily: font.regular, fontSize: 14 },
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
