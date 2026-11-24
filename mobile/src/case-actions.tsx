import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Action, Case } from './api';
import { Card, Divider, color, ui } from './ui';

type Icon = React.ComponentProps<typeof Feather>['name'];

function ActionRow({ title, label, detail, icon, busy, disabled, onPress }:
  { title: string; label: string; detail: string; icon: Icon; busy: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={detail}
    accessibilityState={{ busy, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
    <View style={styles.icon}><Feather name={icon} size={20} color={color.forest} /></View>
    <View style={ui.grow}>
      <Text style={ui.label}>{title}</Text>
      <Text style={ui.small}>{detail}</Text>
    </View>
    {busy ? <ActivityIndicator color={color.forest} /> : <Feather name="chevron-right" size={20} color={color.forest} />}
  </Pressable>;
}

function outreachStatus(data: Case, action: Action) {
  const draft = data.drafts[action];
  if (!draft) return action === 'letter' ? 'Prepare a written request for billing.' : 'Review the script before starting.';
  const receipt = data.receipts[`${draft.revision}:${action}:${draft.hash}`];
  if (receipt?.outcome === 'identity_failed') return 'Ended before identity verification.';
  if (receipt?.state === 'completed') return action === 'letter' ? 'Simulated send complete.' : 'Simulated call complete.';
  if (receipt) return receipt.state === 'awaiting_identity' ? 'Waiting for identity verification.' : 'Call in progress.';
  return data.approvals[action]?.hash === draft.hash ? 'Approved wording.' : 'Draft ready for approval.';
}

export function CaseActions({ data, busy, prepare, preview }:
  { data: Case; busy: string; prepare: (action: Action) => void; preview: () => void }) {
  return <>
    <View style={ui.stack}>
      <Text accessibilityRole="header" style={ui.title}>Act on your findings</Text>
      <Text style={ui.body}>Choose a next step for revision {data.revision}. Letter and call actions are simulated.</Text>
    </View>
    <Card>
      <ActionRow title="Clarification letter" label="Draft clarification letter" icon="mail"
        detail={outreachStatus(data, 'letter')} disabled={!!busy} busy={busy === 'draft-letter'} onPress={() => prepare('letter')} />
      <Divider />
      <ActionRow title="Three-way call" label="Review three-way call plan" icon="phone-call"
        detail={outreachStatus(data, 'call')} disabled={!!busy} busy={busy === 'draft-call'} onPress={() => prepare('call')} />
    </Card>
    <Card tone="tonal">
      <ActionRow title="Redacted evidence packet" label="Preview evidence packet" icon="share-2"
        detail="Preview the source excerpts and case history before sharing." disabled={!!busy} busy={busy === 'preview'} onPress={preview} />
    </Card>
  </>;
}

const styles = StyleSheet.create({
  row: { minHeight: 64, flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 6 },
  icon: { backgroundColor: color.pale, borderRadius: 12, padding: 10 },
  pressed: { opacity: 0.7 },
});
