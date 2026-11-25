import { SvgXml } from 'react-native-svg';
import { artwork } from './phosphor-artwork';

export type IconName = keyof typeof artwork;

export function AppIcon({ name, size, color }: { name: IconName; size: number; color: string }) {
  return <SvgXml xml={artwork[name]} width={size} height={size} color={color}
    accessible={false} importantForAccessibility="no" />;
}
