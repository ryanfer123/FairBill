import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { AppearanceSettingsProvider, useStoredAppearance } from '../src/appearance';
import { SignIn } from '../src/account';
import { accountState, cloudBuild, listenAccount } from '../src/cloud-auth';
import { fairBillThemes, FairBillThemeProvider } from '../src/theme';
import { fonts } from '../src/typography';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const navigationThemes = {
  light: { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: fairBillThemes.light.color.paper } },
  dark: { ...DarkTheme, colors: { ...DarkTheme.colors, background: fairBillThemes.dark.color.paper } },
};

export default function Layout() {
  const reduceMotion = useReducedMotion();
  const session = useSyncExternalStore(listenAccount, accountState);
  const [fontReady, fontError] = useFonts(fonts);
  const appearance = useStoredAppearance();
  const mode = appearance.dark ? 'dark' : 'light';
  const theme = fairBillThemes[mode];
  const ready = appearance.ready && (fontReady || !!fontError);
  const backgroundColor = theme.color.paper;
  useEffect(() => {
    if (ready) void SystemUI.setBackgroundColorAsync(backgroundColor).catch(() => undefined);
  }, [ready, backgroundColor]);

  if (!ready) return null;
  const barStyle = appearance.dark ? 'light' : 'dark';
  return <GestureHandlerRootView style={{ flex: 1, backgroundColor }} onLayout={() => { void SplashScreen.hideAsync().catch(() => undefined); }}>
    <AppearanceSettingsProvider value={appearance}>
      <FairBillThemeProvider value={theme}>
        <ThemeProvider value={navigationThemes[mode]}>
          <PaperProvider theme={theme.material}>
            <StatusBar style={barStyle} />
            {Platform.OS === 'android' && <NavigationBar style={barStyle} />}
            {cloudBuild && session !== 'signed-in' ? <SignIn restoring={session === 'loading'} />
              : <Stack screenOptions={{ headerShown: false, animation: reduceMotion ? 'none' : 'fade', contentStyle: { backgroundColor } }} />}
          </PaperProvider>
        </ThemeProvider>
      </FairBillThemeProvider>
    </AppearanceSettingsProvider>
  </GestureHandlerRootView>;
}
