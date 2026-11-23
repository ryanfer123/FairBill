import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PaperProvider } from 'react-native-paper';
import { color, material } from '../src/theme';

export default function Layout() {
  return <PaperProvider theme={material}>
    <StatusBar style="dark" />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.paper } }} />
  </PaperProvider>;
}
