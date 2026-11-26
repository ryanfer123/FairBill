import { AppIcon } from './icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewProps } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import * as SecureStore from 'expo-secure-store';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { CaseListRow } from './case-list-row';
import { CaseTray } from './case-tray';
import { createCasePageRequests, mergeCasePage, syncArchivePage, type CaseCursor } from './case-page-state';
import { accountUser, cloudBuild } from './cloud-auth';
import { deleteCase, request, type CasePage } from './api';
import { font } from './typography';
import { surfaceReveal } from './motion';
import { Button, Input, LoadingState, Message, Sheet, color, ui } from './ui';

const enterShelf = FadeInDown.withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] }).duration(210).reduceMotion(ReduceMotion.System);

export function CaseList({ onStart, onOpen, onScroll, clearance, onDeleted, onBack }: { onStart: () => void; onDeleted: (id: string) => void; onBack?: () => void; onScroll: ScrollViewProps['onScroll']; clearance: number; onOpen: (id: string) => void }) {
  const scrollGesture = useMemo(() => Gesture.Native(), []);
  const [cases, setCases] = useState<CasePage['cases']>([]);
  const [after, setAfter] = useState<string | null>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [failedCursor, setFailedCursor] = useState<CaseCursor>();
  const requests = useMemo(createCasePageRequests, []);
  const [filter, setFilter] = useState('all');

  const [archive, setArchive] = useState<Set<string>>(new Set());
  const archiveView = !!onBack;
  const [pendingDelete, setPendingDelete] = useState<string>();
  const [options, setOptions] = useState<string>();
  const [labelDraft, setLabelDraft] = useState<{ id: string; value: string }>();
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const acting = useRef(false);
  const owner = cloudBuild ? accountUser()?.id : 'installation';
  const archiveKey = useCallback((id: string) => {
    if (!owner) throw new Error('Sign in to view archived cases.');
    return `fairbill.archive.${owner}.${id}`;
  }, [owner]);

  const labelKey = useCallback((id: string) => `${archiveKey(id)}.label`, [archiveKey]);

  const load = useCallback(async (cursor: CaseCursor) => {
    const attempt = requests.start(cursor);
    setBusy(true);
    setError('');
    setFailedCursor(undefined);
    try {
      const page = await request<CasePage>(`/cases?limit=20${cursor === null ? '' : `&after=${encodeURIComponent(cursor)}`}`);
      if (!requests.isCurrent(attempt)) return;
      const details = await Promise.all(page.cases.map(async item => {
        const [archived, label] = await Promise.all([
          SecureStore.getItemAsync(archiveKey(item.id)), SecureStore.getItemAsync(labelKey(item.id)),
        ]);
        return { id: item.id, archived: archived === '1', label: label ?? '' };
      }));
      if (!requests.isCurrent(attempt)) return;
      setArchive(current => syncArchivePage(current, page.cases, details.map(item => item.archived ? item.id : null), cursor));
      setLabels(current => ({ ...(cursor === null ? {} : current), ...Object.fromEntries(details.map(item => [item.id, item.label])) }));
      setCases(current => mergeCasePage(current, page.cases, cursor));
      setAfter(page.next_after);
    } catch (cause) {
      if (!requests.isCurrent(attempt)) return;
      setFailedCursor(attempt.cursor);
      setError((cause as Error).message);
    } finally {
      if (requests.isCurrent(attempt)) setBusy(false);
    }
  }, [archiveKey, labelKey, requests]);

  useFocusEffect(useCallback(() => {
    void load(null);
    return () => requests.invalidate();
  }, [load, requests]));

  useEffect(() => {
    if (!options) return;
    const closeMenu = BackHandler.addEventListener('hardwareBackPress', () => {
      setOptions(undefined);
      return true;
    });
    return () => closeMenu.remove();
  }, [options]);

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

  async function saveLabel() {
    if (!labelDraft || acting.current) return;
    acting.current = true;
    setBusy(true);
    setError('');
    try {
      const value = labelDraft.value.trim();
      if (value) await SecureStore.setItemAsync(labelKey(labelDraft.id), value);
      else await SecureStore.deleteItemAsync(labelKey(labelDraft.id));
      setLabels(current => ({ ...current, [labelDraft.id]: value }));
      setLabelDraft(undefined);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); acting.current = false; }
  }

  function confirmDelete(id: string) {
    setOptions(undefined);
    setError('');
    setPendingDelete(id);
  }

  async function removeCase(id: string) {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError('');
    try {
      await deleteCase(id);
      setCases(items => items.filter(item => item.id !== id));
      onDeleted(id);
      setNotice('Case deleted.');
      setPendingDelete(undefined);
      if (labels[id]) void SecureStore.deleteItemAsync(labelKey(id)).catch(() => undefined);
      if (archive.has(id)) void SecureStore.deleteItemAsync(archiveKey(id)).catch(() => undefined);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); acting.current = false; }
  }

  const visible = cases.filter(item => archive.has(item.id) === archiveView);
  const filtered = visible.filter((item) => filter === 'all'
    || (item.investigated_revision === item.revision) === (filter === 'complete'));

  const inReview = visible.filter(item => item.investigated_revision !== item.revision).length;
  return <GestureDetector gesture={scrollGesture}><ScrollView style={ui.grow} onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={[ui.content, { paddingBottom: clearance }]}>
    <Animated.View entering={enterShelf} style={styles.cover}>
      <View style={ui.between}>
        <View style={ui.grow}>
          <Text accessibilityRole="header" style={styles.title}>{archiveView ? 'Archived cases' : 'Your cases'}</Text>
          <Text style={styles.subtitle}>{archiveView ? 'Saved in the archive on this device' : 'Your hospital bill reviews'}</Text>
        </View>
        {onBack && <Pressable accessibilityRole="button" accessibilityLabel="Back to settings" onPress={onBack}
          style={({ pressed }) => [styles.archiveBack, pressed && { opacity: 0.72 }]}>
          <AppIcon name="arrow-left" size={23} color={color.paper} />
        </Pressable>}
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
    {error && !pendingDelete && !labelDraft ? <><Message text={error} />
      {failedCursor !== undefined && <Button label="Retry" icon="refresh-cw" onPress={() => void load(failedCursor)} />}
    </> : null}
    <Animated.View key={filter} entering={surfaceReveal} style={styles.shelf}>
      {filtered.map(item => <CaseListRow key={item.id} item={item} label={labels[item.id]} onRename={() => {
          setOptions(undefined); setError(''); setLabelDraft({ id: item.id, value: labels[item.id] ?? '' });
        }} scrollGesture={scrollGesture} archived={archiveView} disabled={busy}
        onOpen={() => onOpen(item.id)} onOptions={() => setOptions(item.id)}
        optionsVisible={options === item.id} onDismissOptions={() => setOptions(undefined)} onArchive={() => void toggleArchive(item.id)}
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
    {labelDraft && <Sheet title="Edit case label" bottom compact onClose={() => { if (!busy) { setLabelDraft(undefined); setError(''); } }}>
      <View style={ui.content}>
        <Input label="Case label" accessibilityLabel="Case label" value={labelDraft.value} maxLength={64} editable={!busy}
          onChangeText={(value) => setLabelDraft({ ...labelDraft, value })} />
        <Text style={ui.small}>The label appears on this device. Clear the field to use the default name.</Text>
        {error ? <Message text={error} /> : null}
        <Button label="Save case label" icon="check" busy={busy} onPress={() => void saveLabel()} />
      </View>
    </Sheet>}
    {pendingDelete && <Sheet title={`Delete case ${pendingDelete.slice(-6).toUpperCase()}?`} bottom compact
      onClose={() => { if (!acting.current) { setError(''); setPendingDelete(undefined); } }}>
      <View style={ui.content}>
        <Text style={ui.body}>This permanently removes the bill, uploaded documents, and review history.</Text>
        {error && <Message text={error} />}
        <Button label="Delete case" icon="trash-2" tone="destructive" busy={busy} onPress={() => void removeCase(pendingDelete)} />
        <Button label="Keep case" tone="ghost" disabled={busy} onPress={() => { setPendingDelete(undefined); setError(''); }} />
      </View>
    </Sheet>}
  </ScrollView></GestureDetector>;
}

const styles = StyleSheet.create({
  cover: { padding: 20, borderRadius: 24, backgroundColor: color.primary, gap: 18 },
  title: { color: color.paper, fontFamily: font.uiSans, fontSize: 40, lineHeight: 44 },
  subtitle: { color: color.primaryContainer, fontFamily: font.regular, fontSize: 16, marginTop: 4 },
  filters: { flexDirection: 'row', borderBottomWidth: 1, borderColor: color.line },
  filter: { flex: 1, minHeight: 48, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', alignContent: 'center', justifyContent: 'center', gap: 5, paddingVertical: 6, borderBottomWidth: 3, borderColor: 'transparent' },
  selectedFilter: { borderColor: color.primary },
  filterLabel: { fontFamily: font.semibold, color: color.muted, fontSize: 15 },
  tally: { fontFamily: font.mono, fontSize: 12, color: color.muted },
  activeLabel: { color: color.primary },
  shelf: { overflow: 'hidden', backgroundColor: color.card, borderRadius: 18, borderColor: color.line, borderWidth: StyleSheet.hairlineWidth },
  notice: { color: color.primary, fontFamily: font.medium },
  archiveBack: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', padding: 22, gap: 10 },
  center: { textAlign: 'center' },
});
