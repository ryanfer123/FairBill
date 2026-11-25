import { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { getBackend } from './api';
import { cloudBuild } from './cloud-auth';
import { Button, color, ui } from './ui';

export function ConnectionStatus({ refresh = 0, problemsOnly = false }:
  { refresh?: number; problemsOnly?: boolean }) {
  const [status, setStatus] = useState<'checking' | 'waiting' | 'connected' | 'unavailable'>('checking');
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<string>();

  useEffect(() => {
    let active = true;
    let pending = false;
    let slow: ReturnType<typeof setTimeout>;
    async function check(fresh: boolean) {
      if (pending || AppState.currentState === 'background') return;
      pending = true;
      setStatus('checking');
      slow = setTimeout(() => { if (active) setStatus('waiting'); }, 3500);
      try {
        const result = await getBackend(fresh);
        if (active) { setStatus('connected'); setMode(result.mode); }
      } catch {
        if (active) setStatus('unavailable');
      } finally {
        clearTimeout(slow);
        pending = false;
      }
    }
    void check(attempt > 0 || !problemsOnly);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check(true);
    });
    return () => { active = false; clearTimeout(slow); subscription.remove(); };
  }, [refresh, attempt, problemsOnly]);

  if (problemsOnly && (status === 'checking' || status === 'connected')) return null;
  return <View accessibilityLiveRegion="polite" style={styles.strip}>
    <Text style={ui.small}>{status === 'connected' ? 'Server connected'
      : status === 'unavailable' ? 'Can’t reach FairBill. Check your internet connection and try again.'
      : status === 'waiting' && cloudBuild ? 'FairBill is waking up. This can take a moment.' : 'Checking connection…'}</Text>
    {!problemsOnly && status === 'connected' && mode &&
      <Text style={ui.small}>Drafting · {mode === 'Gemini' ? 'Gemini available' : 'Template mode'}</Text>}
    {status === 'unavailable' &&
      <Button label="Retry connection" icon="refresh-cw" tone="ghost" onPress={() => setAttempt((value) => value + 1)} />}
  </View>;
}

const styles = StyleSheet.create({
  strip: { padding: 12, gap: 6, borderBottomColor: color.line, borderBottomWidth: StyleSheet.hairlineWidth },
});
