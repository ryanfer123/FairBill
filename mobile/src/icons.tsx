import Svg, { Path } from 'react-native-svg';

// A 24-unit outline set drawn for FairBill. Related actions share the same paper and check shapes.
const paths = {
  'alert-circle': 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-4v5m0 3h.01',
  'arrow-left': 'M20 12H4m6-6-6 6 6 6',
  'arrow-right': 'M4 12h16m-6-6 6 6-6 6',
  'arrow-up-right': 'M6 18 18 6M9 6h9v9',
  camera: 'M4 7h4l1.5-2h5L16 7h4v12H4V7Zm11 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  check: 'm5 12 4.5 4.5L19 7',
  'check-circle': 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-13 .5 2.7 2.7 5.2-5.5',
  'check-square': 'M4.5 5h15v14h-15V5Zm3.7 7 2.6 2.6 5.3-5.3',
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-right': 'm9 6 6 6-6 6',
  'chevron-up': 'm6 15 6-6 6 6',
  circle: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  'edit-2': 'm5 15 10-10a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Zm8.5-8.5 3 3',
  'external-link': 'M13 4h7v7m0-7-9 9m-2-7H4v14h14v-5',
  'file-plus': 'M5 3h9l5 5v13H5V3Zm9 0v5h5m-7 3v6m-3-3h6',
  'file-text': 'M5 3h9l5 5v13H5V3Zm9 0v5h5M8.5 12h7m-7 4h7',
  folder: 'M3 7a2 2 0 0 1 2-2h5l2.5 2.5H19a2 2 0 0 1 2 2V19H3V7Zm.5 4h17',
  heart: 'M12 20l-7.4-7.2a4.7 4.7 0 1 1 6.6-6.7l.8.8.8-.8a4.7 4.7 0 1 1 6.6 6.7L12 20Z',
  'help-circle': 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.5 9a2.5 2.5 0 1 1 4.2 1.8c-1 1-1.7 1.1-1.7 2.7m0 3h.01',
  image: 'M4 5h16v14H4V5Zm0 12 5-4 4 3 3-4 4 5m-6.5-7.7h.01',
  key: 'M13 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-1 3 8 8m-3-3-2 2m5 1-2 2',
  layers: 'm12 4 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 4 9 5 9-5',
  link: 'M9 15l6-6m-7 9-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0m2 4a3.5 3.5 0 0 0 5 0l4-4a3.5 3.5 0 0 0-5-5l-1 1',
  lock: 'M5 10h14v11H5V10Zm3 0V7a4 4 0 0 1 8 0v3m-4 5v2',
  'log-out': 'M12 4H5v16h7m-2-8h11m-4-4 4 4-4 4',
  mail: 'M3 6h18v12H3V6Zm.5.5L12 13l8.5-6.5',
  maximize: 'M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5',
  'message-circle': 'M21 11a9 8 0 0 1-9 8H9l-5 2 1-5a7.5 7.5 0 0 1-2-5 9 8 0 0 1 18 0Zm-13-.2h8m-8 3.5h5',
  phone: 'm7 4 3 4-2 2c1.4 2.7 3.3 4.6 6 6l2-2 4 3-1.1 2.2c-.4.7-1.3 1.1-2.2 1C10.2 19.2 4.8 13.8 3.8 7.3c-.1-.9.3-1.8 1-2.2L7 4Z',
  'phone-call': 'm7 4 3 4-2 2c1.4 2.7 3.3 4.6 6 6l2-2 4 3-1.1 2.2c-.4.7-1.3 1.1-2.2 1C10.2 19.2 4.8 13.8 3.8 7.3c-.1-.9.3-1.8 1-2.2L7 4Zm8 0a6 6 0 0 1 5 5',
  plus: 'M12 5v14M5 12h14',
  receipt: 'M5 3h14v18l-3.5-2L12 21l-3.5-2L5 21V3Zm3.5 5h7m-7 4h7m-7 4H12',
  'refresh-cw': 'M20 10a8 8 0 0 0-14-4L4 9m0-5v5h5m-5 5a8 8 0 0 0 14 4l2-3m0 5v-5h-5',
  search: 'M16.5 10a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Zm-2 4.5 5.5 5.5',
  send: 'm3 10 18-7-7 18-3-8-8-3Zm8 3L21 3',
  settings: 'M4 6h16M4 12h16M4 18h16M8 3.5v5m8 1v5m-6 1v5',
  'share-2': 'M8 13v7h12v-7m-9-3 3-3 3 3m-3-3v9M4 14V4h10',
  shield: 'M12 3c3.5 2 6 3 8 3v5c0 4.8-2.6 8-8 10-5.4-2-8-5.2-8-10V6c2 0 4.5-1 8-3Zm-4 9 3 3 5-6',
  square: 'M4.5 5h15v14h-15V5Z',
  'trash-2': 'M4 7h16m-11 0V4h6v3M6 7l1 13h10l1-13m-8 4v5m4-5v5',
  upload: 'M5 14v5h14v-5m-7 1V4m-4 4 4-4 4 4',
  user: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM5 20v-1a7 5 0 0 1 14 0v1',
  'user-check': 'M13.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0ZM4 19a6 4 0 0 1 10-3m1 2 2 2 4-4',
  x: 'm6 6 12 12M18 6 6 18',
} as const;

export type IconName = keyof typeof paths;

export function AppIcon({ name, size, color }: { name: IconName; size: number; color: string }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false} importantForAccessibility="no">
    <Path d={paths[name]} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}
