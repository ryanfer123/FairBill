import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Appearance, Platform, View, useColorScheme } from 'react-native';
import { SegmentedButtons } from 'react-native-paper';
import * as SecureStore from 'expo-secure-store';
import { useFairBillTheme } from './theme';
import { Message } from './ui';

type Preference = 'system' | 'light' | 'dark';
const key = 'fairbill_appearance_v1';

function parsePreference(value: unknown): Preference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function applyNativePreference(value: Preference) {
  if (Platform.OS === 'android' || Platform.OS === 'ios') {
    Appearance.setColorScheme(value === 'system' ? 'unspecified' : value);
  }
}

export function useStoredAppearance() {
  const [preference, setPreference] = useState<Preference>('system');
  const [ready, setReady] = useState(false);
  const systemScheme = useColorScheme();
  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(key).catch(() => null).then(value => {
      if (!active) return;
      const stored = parsePreference(value);
      applyNativePreference(stored);
      setPreference(stored);
      setReady(true);
    });
    return () => { active = false; };
  }, []);

  async function update(value: Preference) {
    if (value === preference) return;
    await SecureStore.setItemAsync(key, value);
    applyNativePreference(value);
    setPreference(value);
  }

  return { preference, ready, update, dark: (preference === 'system' ? systemScheme : preference) === 'dark' };
}

const AppearanceSettings = createContext<Pick<ReturnType<typeof useStoredAppearance>, 'preference' | 'update'> | null>(null);
export const AppearanceSettingsProvider = AppearanceSettings.Provider;
const buttons = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

export function AppearanceChoices() {
  const settings = useContext(AppearanceSettings);
  const { ui } = useFairBillTheme();
  const writing = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  if (!settings) return null;

  async function select(value: string) {
    if (!settings || writing.current) return;
    writing.current = true;
    setSaving(true);
    setError(false);
    try { await settings.update(parsePreference(value)); }
    catch { setError(true); }
    finally { writing.current = false; setSaving(false); }
  }

  return <View style={ui.stack}>
    <SegmentedButtons
      value={settings.preference}
      onValueChange={value => void select(value)}
      buttons={buttons.map(button => ({ ...button, disabled: saving, style: { minHeight: 48 } }))}
    />
    {error && <Message text="FairBill couldn’t save your appearance setting. Please try again." />}
  </View>;
}
