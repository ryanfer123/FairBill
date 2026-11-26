import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { TouchableRipple } from 'react-native-paper';
import type { CaptureMethod } from './document-picker';
import { AppIcon, type IconName } from './icons';
import { Button, Divider, color, ui } from './ui';

const alternatives = [
  { method: 'file', label: 'Choose file from device', icon: 'upload' },
  { method: 'photo', label: 'Choose existing photo', icon: 'image' },
] as const satisfies readonly { method: CaptureMethod; label: string; icon: IconName }[];

export function CaptureOptions({ pending, disabled, onChoose }:
  { pending?: CaptureMethod; disabled: boolean; onChoose: (method: CaptureMethod) => void }) {
  return <View style={styles.list}>
    <View style={styles.scan}>
      <Button label="Scan bill photo" icon="camera" busy={pending === 'camera'} disabled={disabled}
        onPress={() => onChoose('camera')} />
      <Text style={[ui.small, styles.hint]}>{Platform.OS === 'android' ? 'Hold the page steady for auto capture.' : 'Keep the full page in frame.'}</Text>
    </View>
    {alternatives.map(({ method, label, icon }) => <View key={method}>
      <Divider />
      <TouchableRipple accessibilityRole="button" accessibilityLabel={label}
        accessibilityState={{ disabled, busy: pending === method }} disabled={disabled} onPress={() => onChoose(method)}>
        <View style={styles.row}>
          <AppIcon name={icon} size={22} color={color.primary} />
          <Text style={[ui.label, ui.grow]}>{label}</Text>
          {pending === method ? <ActivityIndicator size="small" color={color.primary} />
            : <AppIcon name="chevron-right" size={18} color={color.muted} />}
        </View>
      </TouchableRipple>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  list: { backgroundColor: color.card, borderWidth: 1, borderColor: color.line, borderRadius: 18, overflow: 'hidden' },
  scan: { backgroundColor: color.surfaceContainer, gap: 8, padding: 14 },
  hint: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 9, minHeight: 56 },
});
