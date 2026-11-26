import { useFairBillTheme, themedStyles } from './theme';
import { Illustration } from './illustrations';
import { font } from './typography';
import { AppIcon, type IconName } from './icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Action, Case } from './api';
import { Badge, Button, Divider } from './ui';

type Icon = IconName;

function ActionRow({ title, label, detail, icon, busy, disabled, onPress }:
  { title: string; label: string; detail: string; icon: Icon; busy: boolean; disabled: boolean; onPress: () => void }) {
  const { color, ui } = useFairBillTheme();
  const styles = useStyles();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={detail}
    accessibilityState={{ busy, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
    <View style={styles.icon}><AppIcon name={icon} size={20} color={color.primary} /></View>
    <View style={ui.grow}>
      <Text style={ui.label}>{title}</Text>
      <Text style={ui.small}>{detail}</Text>
    </View>
    {busy ? <ActivityIndicator color={color.primary} /> : <AppIcon name="chevron-right" size={20} color={color.primary} />}
  </Pressable>;
}

function outreachStatus(data: Case, action: Action) {
  const draft = data.drafts[action];
  const approved = !!draft && data.approvals[action]?.hash === draft.hash;
  const receipt = draft ? data.receipts[`${draft.revision}:${action}:${draft.hash}`] : undefined;
  return { draft, approved, receipt };
}

export function CaseActions({ data, busy, live, prepare, preview }:
  { data: Case; busy: string; live: boolean; prepare: (action: Action) => void; preview: () => void }) {
  const { ui, color } = useFairBillTheme();
  const styles = useStyles();
  const letter = outreachStatus(data, 'letter');
  const call = outreachStatus(data, 'call');
  const letterSent = letter.receipt?.state === 'completed';
  const letterState = letterSent ? 'Sent' : letter.approved ? 'Approved' : letter.draft ? 'Draft' : 'Ready to draft';
  const callState = call.receipt?.outcome === 'identity_failed' ? 'Ended before identity verification'
    : call.receipt?.state === 'completed' ? 'Call complete'
    : call.receipt?.state === 'awaiting_identity' ? 'Identity verification required'
    : call.receipt ? 'Call in progress'
    : call.approved ? 'Approved' : call.draft ? 'Draft' : 'Ready to prepare';
  const letterSteps = [
    { label: 'Drafted', done: !!letter.draft },
    { label: 'Exact wording approved', done: letter.approved },
    ...(live ? [] : [{ label: 'Sent', done: letterSent }]),
  ];
  return <>
    <View style={ui.between}>
      <View style={[ui.grow, ui.stack]}>
        <Text accessibilityRole="header" style={ui.title}>Act on your findings</Text>
        {!live && <Badge tone="amber">Simulated outreach</Badge>}
      </View>
      <Illustration name="letter" size={58} />
    </View>
    <View style={styles.actionList}>
      <ActionRow title="1. Clarification letter" label="Draft clarification letter" icon="mail"
        detail={letterState} disabled={!!busy} busy={busy === 'draft-letter'} onPress={() => prepare('letter')} />
      <View style={styles.steps}>
        {letterSteps.map((step) => <View style={ui.row} key={step.label}>
          <AppIcon name={step.done ? 'check-circle' : 'square'} size={16} color={step.done ? color.primary : color.muted} />
          <Text style={ui.small}>{step.label} · {step.done ? 'Complete' : 'Pending'}</Text>
        </View>)}
      </View>
      {letter.draft && <View style={styles.preview}>
        <Text style={ui.kicker}>Letter excerpt</Text>
        <Text numberOfLines={3} style={styles.paperCopy}>{letter.draft.text}</Text>
        <Button label="Review exact letter" icon="file-text" tone="ghost" disabled={!!busy} onPress={() => prepare('letter')} />
      </View>}
      <Divider />
      <ActionRow title={live ? '2. Billing call script' : '2. Three-way call'} label={live ? 'Review billing call script' : 'Review three-way call plan'} icon="phone-call"
        detail={callState} disabled={!!busy} busy={busy === 'draft-call'} onPress={() => prepare('call')} />
      <Divider />
      <ActionRow title="3. Redacted evidence packet" label="Preview evidence packet" icon="share-2"
        detail="Preview the redactions before sharing." disabled={!!busy} busy={busy === 'preview'} onPress={preview} />
    </View>
  </>;
}

const useStyles = themedStyles(({ color }) => StyleSheet.create({
  preview: { backgroundColor: color.card, borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line, borderRadius: 12, padding: 14, marginBottom: 12, gap: 8 },
  paperCopy: { color: color.ink, fontFamily: font.editorial, fontSize: 19, lineHeight: 24 },
  actionList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  steps: { paddingLeft: 52, paddingBottom: 14, gap: 5 },
  row: { minHeight: 64, flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 6 },
  icon: { backgroundColor: color.secondaryContainer, borderRadius: 12, padding: 10 },
  pressed: { opacity: 0.7 },
}));
