import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { endpoint, hostedBuild, testEndpoint } from './api';
import { Badge, color } from './ui';

export function ConnectionStatus({ mode, refresh = 0 }: { mode?: string | null; refresh?: number }) {
  const service = hostedBuild ? 'Test server' : 'Local API';
  const [status, setStatus] = useState<'checking' | 'connected' | 'unavailable'>('checking');

  useFocusEffect(useCallback(() => {
    let active = true;
    let pending = false;
    async function check() {
      if (pending || AppState.currentState === 'background') return;
      pending = true;
      try {
        await testEndpoint(await endpoint());
        if (active) setStatus('connected');
      } catch {
        if (active) setStatus('unavailable');
      } finally {
        pending = false;
      }
    }
    void check();
    const timer = setInterval(() => void check(), 15000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => { active = false; clearInterval(timer); subscription.remove(); };
  }, [refresh]));

  return <View accessibilityLiveRegion="polite" style={styles.strip}>
    <Badge tone={status === 'unavailable' ? 'amber' : 'neutral'}>
      {status === 'connected' ? `${service} connected` : status === 'unavailable' ? `${service} unavailable` : 'Checking connection'}
    </Badge>
    <Badge tone="neutral">{mode === 'Gemini' ? 'Gemini planner' : mode ? 'Offline planner' : 'Planner pending'}</Badge>
  </View>;
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingBottom: 8,
    borderBottomColor: color.line, borderBottomWidth: StyleSheet.hairlineWidth },
});
