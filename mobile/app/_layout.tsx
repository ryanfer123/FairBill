import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useSyncExternalStore } from 'react';
import { PaperProvider } from 'react-native-paper';
import { SignIn } from '../src/account';
import { accountState, cloudBuild, listenAccount } from '../src/cloud-auth';
import { color, material } from '../src/theme';
import { fonts } from '../src/typography';

export default function Layout() {
  const session = useSyncExternalStore(listenAccount, accountState);
  const [fontReady, fontError] = useFonts(fonts);
  if (!fontReady && !fontError) return null;
  return <PaperProvider theme={material}>
    <StatusBar style="dark" />
    {cloudBuild && session !== 'signed-in' ? <SignIn restoring={session === 'loading'} />
      : <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.paper } }} />}
  </PaperProvider>;
}
