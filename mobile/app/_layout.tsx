import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useSyncExternalStore } from 'react';
import { PaperProvider } from 'react-native-paper';
import { FirstRun } from '../src/first-run';
import { SignIn } from '../src/account';
import { accountState, cloudBuild, listenAccount } from '../src/cloud-auth';
import { color, material } from '../src/theme';
import { fonts } from '../src/typography';

export default function Layout() {
  const reduceMotion = useReducedMotion();
  const session = useSyncExternalStore(listenAccount, accountState);
  const [fontReady, fontError] = useFonts(fonts);
  if (!fontReady && !fontError) return null;
  return <GestureHandlerRootView style={{ flex: 1 }}><PaperProvider theme={material}>
    <StatusBar style="dark" />
    <FirstRun>{cloudBuild && session !== 'signed-in' ? <SignIn restoring={session === 'loading'} />
      : <Stack screenOptions={{ headerShown: false, animation: reduceMotion ? 'none' : 'fade', contentStyle: { backgroundColor: color.paper } }} />}</FirstRun>
  </PaperProvider></GestureHandlerRootView>;
}
