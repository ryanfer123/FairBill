import { useFairBillTheme, themedStyles } from './theme';
import { AppIcon } from './icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewProps } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import * as SecureStore from 'expo-secure-store';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { CaseListRow } from './case-list-row';
import { caseLibrary, type CaseFilter } from './case-library';
import { CaseTray } from './case-tray';
import { createCasePageRequests, mergeCasePage, syncArchivePage, type CaseCursor } from './case-page-state';
import { accountUser, cloudBuild } from './cloud-auth';
import { deleteCase, request, type CasePage } from './api';
import { font } from './typography';
import { surfaceReveal } from './motion';
import { Button, Input, LoadingState, Message, SectionHeader, Sheet } from './ui';

const enterShelf = FadeInDown.withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] }).duration(210).reduceMotion(ReduceMotion.System);

export function CaseList({ onStart, onOpen, onScroll, clearance, onDeleted, onBack }: { onStart: () => void; onDeleted: (id: string) => void; onBack?: () => void; onScroll: ScrollViewProps['onScroll']; clearance: number; onOpen: (id: string) => void }) {
  const { ui, color } = useFairBillTheme();
  const styles = useStyles();
  const scrollGesture = useMemo(() => Gesture.Native(), []);
  const [cases, setCases] = useState<CasePage['cases']>([]);
  const [after, setAfter] = useState<string | null>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [failedCursor, setFailedCursor] = useState<CaseCursor>();
  const requests = useMemo(createCasePageRequests, []);
  const [filter, setFilter] = useState<CaseFilter>('all');
  const [full, setFull] = useState(false);

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

  const visible = cases.filter(item => archive.has(item.id) === archiveView && (!cloudBuild || !item.sample));
  const library = caseLibrary(visible, filter, full, archiveView, after);
  const hasMatches = !!library.featured || !!library.rows.length;
  const inReview = library.completeInReview;
  const renderCase = (item: CasePage['cases'][number], featured = false) => <CaseListRow key={item.id} item={item}
    label={labels[item.id]} featured={featured} onRename={() => {
      setOptions(undefined);
      setError('');
      setLabelDraft({ id: item.id, value: labels[item.id] ?? '' });
    }} scrollGesture={scrollGesture} archived={archiveView} disabled={busy}
    onOpen={() => onOpen(item.id)} onOptions={() => setOptions(item.id)}
    optionsVisible={options === item.id} onDismissOptions={() => setOptions(undefined)} onArchive={() => void toggleArchive(item.id)}
    onDelete={() => confirmDelete(item.id)} />;

  return <GestureDetector gesture={scrollGesture}><ScrollView style={ui.grow} onScroll={onScroll} scrollEventThrottle={16}
    contentContainerStyle={[ui.content, { paddingBottom: clearance }]}>
    <Animated.View entering={enterShelf} style={styles.header}>
      <View style={ui.between}>
        <View style={ui.grow}>
          <Text accessibilityRole="header" style={styles.title}>{archiveView ? 'Archived cases' : 'Your cases'}</Text>
          {archiveView ? <Text style={ui.small}>Archived on this device</Text>
            : !busy && !error && inReview != null && inReview > 0
            ? <Text style={ui.small}>{inReview} {inReview === 1 ? 'case needs' : 'cases need'} review</Text> : null}
        </View>
        {onBack && <Pressable accessibilityRole="button" accessibilityLabel="Back to settings" onPress={onBack}
          style={({ pressed }) => [styles.archiveBack, pressed && { opacity: 0.72 }]}>
          <AppIcon name="arrow-left" size={23} color={color.primary} />
        </Pressable>}
      </View>
    </Animated.View>
    {!!notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}
    <View style={styles.filters} accessibilityRole="tablist">
      {([{ key: 'all', label: 'All' }, { key: 'open', label: 'In review' }, { key: 'complete', label: 'Reviewed' }] as const).map(tab => {
        const selected = filter === tab.key;
        return <Pressable key={tab.key} accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected }}
          onPress={() => { setOptions(undefined); setFilter(tab.key); }} style={[styles.filter, selected && styles.selectedFilter]}>
          <Text style={[styles.filterLabel, selected && styles.activeLabel]}>{tab.label}</Text>
        </Pressable>;
      })}
    </View>
    {error && !pendingDelete && !labelDraft ? <><Message text={error} />
      {failedCursor !== undefined && <Button label="Retry" icon="refresh-cw" onPress={() => void load(failedCursor)} />}
    </> : null}
    <Animated.View key={filter} entering={surfaceReveal} style={styles.shelf}>
      {library.featured && renderCase(library.featured, true)}
      {library.rows.length > 0 && <>
        {!archiveView && <SectionHeader>{full ? 'All cases' : 'Recent cases'}</SectionHeader>}
        {library.rows.map(item => renderCase(item))}
      </>}
      {library.canShowAll && <Button label="View all cases" tone="light" icon="arrow-right" disabled={busy}
        onPress={() => setFull(true)} />}
      {full && !archiveView && hasMatches && <Button label="Show recent cases" tone="ghost" disabled={busy}
        onPress={() => setFull(false)} />}
      {!busy && !error && !hasMatches && <View style={styles.empty}>
        <CaseTray />
        <Text style={[ui.heading, styles.center]}>{archiveView && filter === 'all' ? 'No archived cases here'
          : filter === 'complete' ? 'No reviewed cases here' : filter === 'open' ? 'No cases in review here' : 'No cases yet'}</Text>
        <Text style={[ui.body, styles.center]}>{after ? 'Load more cases to check the next page.'
          : archiveView && filter === 'all' ? 'Use the options beside a case to archive it.'
          : !visible.length ? 'Cases appear here after you start a bill review.' : 'Try another filter to see your other cases.'}</Text>
        {!archiveView && !visible.length && !after && <Button label="Start a bill review" onPress={onStart} />}
      </View>}
    </Animated.View>
    {busy && <LoadingState label="Loading cases" />}
    {!busy && !error && library.canLoadMore && after && <Button label="Load more cases" tone="ghost" onPress={() => void load(after)} />}
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

const useStyles = themedStyles(({ color }) => StyleSheet.create({
  header: { gap: 4, paddingTop: 6 },
  title: { color: color.ink, fontFamily: font.uiSans, fontSize: 36, lineHeight: 42 },
  filters: { flexDirection: 'row', borderBottomWidth: 1, borderColor: color.line },
  filter: { flex: 1, minHeight: 48, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', alignContent: 'center', justifyContent: 'center', gap: 5, paddingVertical: 6, borderBottomWidth: 3, borderColor: 'transparent' },
  selectedFilter: { borderColor: color.primary },
  filterLabel: { fontFamily: font.semibold, color: color.muted, fontSize: 15 },
  activeLabel: { color: color.primary },
  shelf: { gap: 12 },
  notice: { color: color.primary, fontFamily: font.medium },
  archiveBack: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', padding: 22, gap: 10, borderRadius: 18, borderColor: color.line,
    borderWidth: StyleSheet.hairlineWidth, backgroundColor: color.card },
  center: { textAlign: 'center' },
}));
