import { AppIcon } from './icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewProps } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import * as SecureStore from 'expo-secure-store';
import { CaseListRow } from './case-list-row';
import { CaseTray } from './case-tray';
import { accountUser, cloudBuild } from './cloud-auth';
import { deleteCase, request, type CasePage } from './api';
import { font } from './typography';
import { surfaceReveal } from './motion';
import { Button, LoadingState, Message, Sheet, color, ui } from './ui';

const enterShelf = FadeInDown.withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] }).duration(210).reduceMotion(ReduceMotion.System);

export function CaseList({ onStart, onOpen, onScroll, clearance, onDeleted }: { onStart: () => void; onDeleted: (id: string) => void; onScroll: ScrollViewProps['onScroll']; clearance: number; onOpen: (id: string) => void }) {
  const [cases, setCases] = useState<CasePage['cases']>([]);
  const [after, setAfter] = useState<string | null>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  const [archive, setArchive] = useState<Set<string>>(new Set());
  const [archiveView, setArchiveView] = useState(false);
  const [options, setOptions] = useState<string>();
  const [notice, setNotice] = useState('');
  const acting = useRef(false);
  const owner = cloudBuild ? accountUser()?.id : 'installation';
  const archiveKey = useCallback((id: string) => {
    if (!owner) throw new Error('Sign in to view archived cases.');
    return `fairbill.archive.${owner}.${id}`;
  }, [owner]);

  const load = useCallback(async (cursor?: string) => {
    setBusy(true);
    setError('');
    try {
      const page = await request<CasePage>(`/cases?limit=20${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`);
      const states = await Promise.all(page.cases.map(async item =>
        (await SecureStore.getItemAsync(archiveKey(item.id))) === '1' ? item.id : null));
      setArchive(current => new Set([...(cursor ? current : []), ...states.filter((id): id is string => id !== null)]));
      setCases((items) => cursor ? [...items, ...page.cases] : page.cases);
      setAfter(page.next_after);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }, [archiveKey]);

  useEffect(() => { void load(); }, [load]);

  async function toggleArchive(id: string) {
    setOptions(undefined);
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError('');
    try {
      const restore = archive.has(id);
      if (restore) await SecureStore.deleteItemAsync(archiveKey(id));
      else await SecureStore.setItemAsync(archiveKey(id), '1');
      setArchive(current => {
        const next = new Set(current);
        if (restore) next.delete(id);
        else next.add(id);
        return next;
      });
      setNotice(restore ? 'Case restored to your inbox.' : 'Case archived on this device.');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); acting.current = false; }
  }

  function confirmDelete(id: string) {
    setOptions(undefined);
    Alert.alert(`Delete case ${id.slice(-6).toUpperCase()}?`, 'This permanently removes the bill, uploaded documents and review history.', [
      { text: 'Keep case', style: 'cancel' },
      { text: 'Delete case', style: 'destructive', onPress: async () => {
        if (acting.current) return;
        acting.current = true;
        setBusy(true);
        setError('');
        try {
          await deleteCase(id);
          setCases(items => items.filter(item => item.id !== id));
          onDeleted(id);
          setNotice('Case deleted.');
          if (archive.has(id)) await SecureStore.deleteItemAsync(archiveKey(id));
        } catch (cause) { setError((cause as Error).message); }
        finally { setBusy(false); acting.current = false; }
      } },
    ]);
  }

  const visible = cases.filter(item => archive.has(item.id) === archiveView);
  const filtered = visible.filter((item) => filter === 'all'
    || (item.investigated_revision === item.revision) === (filter === 'complete'));

  const inReview = visible.filter(item => item.investigated_revision !== item.revision).length;
  return <ScrollView style={ui.grow} onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={[ui.content, { paddingBottom: clearance }]}>
    <Animated.View entering={enterShelf} style={styles.cover}>
      <View style={ui.between}>
        <View style={ui.grow}>
          <Text accessibilityRole="header" style={styles.title}>{archiveView ? 'Archived cases' : 'Your cases'}</Text>
          <Text style={styles.subtitle}>{archiveView ? 'Saved in the archive on this device' : 'Your hospital bill reviews'}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={archiveView ? 'Back to case inbox' : 'Open archived cases'}
          onPress={() => { setArchiveView(!archiveView); setOptions(undefined); setFilter('all'); setNotice(''); }}
          style={({ pressed }) => [styles.archiveButton, pressed && { opacity: 0.72 }]}>
          <AppIcon name={archiveView ? 'folder' : 'archive'} size={21} color={color.primaryContainer} />
          <Text style={styles.archiveLabel}>{archiveView ? 'Inbox' : 'Archive'}</Text>
        </Pressable>
      </View>
    </Animated.View>
    {!!notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}
    <View style={styles.filters}>
      {([{ key: 'all', label: 'All' }, { key: 'open', label: 'In review' }, { key: 'complete', label: 'Reviewed' }] as const).map(tab => {
        const selected = filter === tab.key;
        const count = tab.key === 'all' ? visible.length : tab.key === 'open' ? inReview : visible.length - inReview;
        return <Pressable key={tab.key} accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected }}
          onPress={() => setFilter(tab.key)} style={[styles.filter, selected && styles.selectedFilter]}>
          <Text style={[styles.filterLabel, selected && styles.activeLabel]}>{tab.label}</Text>
          {!busy && !error && !after && <Text style={[styles.tally, selected && styles.activeLabel]}>{count}</Text>}
        </Pressable>;
      })}
    </View>
    {error ? <><Message text={error} /><Button label="Retry" icon="refresh-cw" onPress={() => void load(after || undefined)} /></> : null}
    <Animated.View key={filter} entering={surfaceReveal} style={styles.shelf}>
      {filtered.map(item => <CaseListRow key={item.id} item={item} archived={archiveView} disabled={busy}
        onOpen={() => onOpen(item.id)} onOptions={() => setOptions(item.id)} onArchive={() => void toggleArchive(item.id)}
        onDelete={() => confirmDelete(item.id)} />)}
      {!busy && !error && !filtered.length && <View style={styles.empty}>
        <CaseTray />
        <Text style={ui.heading}>{archiveView && filter === 'all' ? 'No archived cases here' : !visible.length && filter === 'all' ? 'No cases in your inbox' : filter === 'complete' ? 'No reviewed cases here' : 'No cases in review here'}</Text>
        <Text style={[ui.body, styles.center]}>{after ? 'Load more cases to check the next page.' : archiveView && filter === 'all' ? 'Swipe a case right to archive it here.' : !visible.length ? 'New bill reviews will appear here.' : 'Change the filter to see your other bills.'}</Text>
        {!archiveView && !visible.length && !after && <Button label="Start a bill review" onPress={onStart} />}
      </View>}
    </Animated.View>
    {busy && <LoadingState label="Loading cases" />}
    {!busy && !error && after && <Button label="Load more cases" tone="ghost" onPress={() => void load(after)} />}
    {options && <Sheet title={`Case ${options.slice(-6).toUpperCase()}`} bottom onClose={() => setOptions(undefined)}>
      <View style={ui.content}>
        <Button label={archive.has(options) ? 'Restore to inbox' : 'Archive on this device'}
          icon={archive.has(options) ? 'restore' : 'archive'} tone="light" onPress={() => void toggleArchive(options)} />
        <Button label="Delete case" icon="trash-2" tone="destructive" onPress={() => confirmDelete(options)} />
      </View>
    </Sheet>}
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
  shelf: { overflow: 'hidden', backgroundColor: color.card, borderRadius: 18, borderColor: color.line, borderWidth: StyleSheet.hairlineWidth },
  notice: { color: color.primary, fontFamily: font.medium },
  archiveButton: { alignItems: 'center', justifyContent: 'center', minHeight: 48, minWidth: 64, padding: 6, borderRadius: 16, borderWidth: 1, borderColor: color.inversePrimary },
  archiveLabel: { color: color.primaryContainer, fontSize: 12, fontFamily: font.semibold },
  empty: { alignItems: 'center', padding: 22, gap: 10 },
  center: { textAlign: 'center' },
});
