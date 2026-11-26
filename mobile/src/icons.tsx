import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

type Glyph = ComponentProps<typeof Ionicons>['name'];

const glyphs = {
  archive: 'archive-outline', restore: 'arrow-undo-outline', more: 'ellipsis-horizontal',
  'alert-circle': 'alert-circle-outline', 'arrow-left': 'arrow-back', 'arrow-right': 'arrow-forward',
  'arrow-up-right': 'arrow-forward', camera: 'camera-outline', check: 'checkmark',
  'check-circle': 'checkmark-circle-outline', 'check-square': 'checkbox-outline',
  'chevron-down': 'chevron-down', 'chevron-right': 'chevron-forward', 'chevron-up': 'chevron-up',
  circle: 'ellipse-outline', 'edit-2': 'pencil-outline', 'external-link': 'open-outline',
  'file-plus': 'document-attach-outline', 'file-text': 'document-text-outline', folder: 'file-tray-full-outline',
  heart: 'heart-outline', 'help-circle': 'help-circle-outline', image: 'image-outline', key: 'key-outline',
  layers: 'layers-outline', link: 'link-outline', lock: 'lock-closed-outline', 'log-out': 'log-out-outline',
  mail: 'mail-outline', maximize: 'scan-outline', 'message-circle': 'chatbubble-ellipses-outline',
  phone: 'call-outline', 'phone-call': 'call', plus: 'add', receipt: 'document-text-outline',
  'refresh-cw': 'refresh', search: 'search-outline', send: 'paper-plane-outline', settings: 'options-outline',
  'share-2': 'share-outline', shield: 'shield-checkmark-outline', square: 'square-outline',
  'trash-2': 'trash-outline', upload: 'cloud-upload-outline', user: 'person-outline',
  'user-check': 'person-circle-outline', x: 'close',
} as const satisfies Record<string, Glyph>;

export type IconName = keyof typeof glyphs;
const selectedGlyphs: Partial<Record<IconName, Glyph>> = { folder: 'file-tray-full', receipt: 'document-text', settings: 'options' };

export function AppIcon({ name, size, color, selected }: { name: IconName; size: number; color: string; selected?: boolean }) {
  return <Ionicons name={(selected && selectedGlyphs[name]) || glyphs[name]} size={size} color={color}
    allowFontScaling={false} accessible={false} importantForAccessibility="no"
    style={name === 'arrow-up-right' ? { transform: [{ rotate: '-45deg' }] } : undefined} />;
}
