import { useFairBillTheme } from './theme';
import Svg, { Ellipse, G, Path } from 'react-native-svg';

export function CaseTray() {
  const { color } = useFairBillTheme();
  return <Svg width="100%" height={150} viewBox="0 0 280 150" accessible={false} importantForAccessibility="no">
    <Ellipse cx={142} cy={128} rx={87} ry={7} fill={color.illustration.shadow} />
    <G strokeLinejoin="round" strokeLinecap="round" stroke={color.primary} strokeWidth={2}>
      <Path d="m57 83 28-37 100-9 30 38-27 40-117 8Z" fill={color.illustration.tray} />
      <Path d="m60 83 27-33 94-8 28 33-24 34-113 9Z" fill={color.illustration.trayInterior} />
      <G rotation={-8} origin="138,72">
        <Path d="M105 20h54l11 12v66l-7-3-7 3-7-3-7 3-7-3-7 3-7-3-7 3-9-4Z" fill={color.illustration.page} />
        <Path d="M158 21v13h11M116 40h20m-20 10h40" fill="none" />
        <Path d="M116 60h23m7 0h10m-40 9h18m12 0h10" stroke={color.illustration.pageRule} />
      </G>
      <Path d="m57 83 39-3 9 12 35-3 8-13 67-5-25 43-115 10Z" fill={color.illustration.gold} />
      <Path d="m75 124 115-10 25-43v14l-22 40-115 11Z" fill={color.illustration.goldDeep} />
      <Path d="m105 111 40-4" fill="none" />
    </G>
  </Svg>;
}
