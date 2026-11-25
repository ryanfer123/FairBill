import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { color } from './theme';

export type IllustrationName = 'receipt' | 'balance' | 'corrected' | 'evidence' | 'letter' | 'history' | 'settings'
  | 'cases' | 'confirm' | 'identity' | 'packet' | 'welcome' | 'signin';

const tones: Record<IllustrationName, string> = {
  receipt: color.secondaryContainer, balance: color.tertiaryContainer, corrected: color.secondaryContainer,
  evidence: color.secondaryContainer, letter: color.tertiaryContainer, history: color.secondaryContainer,
  settings: color.surfaceContainer, cases: color.secondaryContainer, confirm: color.tertiaryContainer,
  identity: color.tertiaryContainer, packet: color.secondaryContainer, welcome: color.secondaryContainer,
  signin: color.surfaceContainer,
};

function Receipt() {
  return <>
    <Path d="M17 9h19l9 9v36l-5-3-5 3-5-3-5 3-5-3-5 3V12a3 3 0 0 1 2-3Z" fill={color.card} />
    <Path d="M36 9v10h9M21 23h11m-11 7h17m-17 7h10m-10 7h8" />
  </>;
}

function Artwork({ name }: { name: IllustrationName }) {
  switch (name) {
    case 'balance':
      return <><Path d="M32 14v34m-9 1h18M15 25l34-6M18 25l-7 13h14l-7-13Zm27-5-7 13h14l-7-13Z" />
        <Circle cx={32} cy={22} r={3} fill={color.card} /></>;
    case 'history':
      return <><Path d="M16 23a19 19 0 1 1-1 15m-1-24v11h11M32 22v12l8 4" />
        <Circle cx={32} cy={34} r={1} fill={color.primary} /></>;
    case 'settings':
      return <Path d="M14 20h36M14 32h36M14 44h36M23 15v10m18 2v10m-14 2v10" />;
    case 'cases':
      return <><Path d="M11 24v-5a3 3 0 0 1 3-3h11l5 5h17a3 3 0 0 1 3 3v4" />
        <Path d="M12 27h41l-5 17a4 4 0 0 1-4 3H16a4 4 0 0 1-4-4Z" fill={color.card} /><Path d="M21 35h13m-13 5h8" /></>;
    case 'letter':
      return <><Rect x={12} y={18} width={40} height={29} rx={4} fill={color.card} />
        <Path d="m13 21 15 11a7 7 0 0 0 8 0l15-11M14 44l11-9m25 9-11-9" /></>;
    case 'identity':
      return <><Rect x={11} y={18} width={42} height={28} rx={4} fill={color.card} />
        <Circle cx={22} cy={28} r={4} /><Path d="M15 40a7 7 0 0 1 14 0m6-12h10m-10 6h7" /></>;
    case 'signin':
      return <><Rect x={17} y={27} width={30} height={23} rx={5} fill={color.card} />
        <Path d="M23 27v-6a9 9 0 0 1 18 0v6m-9 10v5" />
        <Circle cx={32} cy={36} r={2.5} fill={color.tertiaryContainer} /></>;
    case 'packet':
      return <><Receipt /><Rect x={20} y={29} width={18} height={2} rx={1} fill={color.primary} />
        <Path d="M48 33c3 2 6 3 9 3v6c0 6-4 10-9 12-5-2-9-6-9-12v-6c3 0 6-1 9-3Z" fill={color.secondaryContainer} />
        <Path d="m44 43 3 3 5-6" /></>;
    case 'corrected':
      return <><Receipt /><Circle cx={44} cy={42} r={11} fill={color.primary} /><Path d="m39 42 3 3 6-6" stroke={color.onPrimary} /></>;
    case 'confirm':
      return <><Receipt /><Path d="M10 34h41" strokeDasharray="3 3" /><Path d="m40 43 4 4 8-8" /></>;
    default:
      return <><Receipt /><Circle cx={39} cy={35} r={11} fill={color.tertiaryContainer} />
        <Path d="m47 43 9 9" strokeWidth={3} />
        {name === 'evidence' ? <Path d="M34 35h10m-10 4h6" /> : <Path d="m34 35 3 3 7-7" />}</>;
  }
}

export function Illustration({ name, size = 52 }: { name: IllustrationName; size?: number }) {
  return <View style={styles.art} accessible={false} importantForAccessibility="no-hide-descendants" pointerEvents="none">
    <Svg viewBox="0 0 64 64" width={size} height={size} fill="none" stroke={color.primary}
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" accessible={false}>
      <Circle cx={32} cy={32} r={28} fill={tones[name]} stroke="none" />
      <Artwork name={name} />
    </Svg>
  </View>;
}

const styles = StyleSheet.create({ art: { flexShrink: 0 } });
