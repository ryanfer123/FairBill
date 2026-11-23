import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { color } from '../src/ui';

export default function Layout() {
  return <>
    <StatusBar style="dark" />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.paper } }} />
  </>;
}
