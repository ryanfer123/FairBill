import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { request, type CasePage } from './api';
import { finishFirstBillGuide, shouldShowFirstBillGuide } from './first-bill-guide';
import { useFairBillTheme } from './theme';
import { Button, Card, Divider, SectionHeader } from './ui';

const steps = [
  { title: 'Add your itemised bill', detail: 'Use the pages that list each service and its charge.' },
  { title: 'Confirm the charges', detail: 'Compare the extracted lines with your bill and correct what was misread.' },
  { title: 'See questions for billing', detail: 'Open each question to see its source before deciding what to share.' },
];

export function BillReviewSteps({ detailed = false }: { detailed?: boolean }) {
  const { ui } = useFairBillTheme();
  if (!detailed) return <Text style={ui.body}>{steps.map(step => step.title).join(' → ')}</Text>;
  return <View style={ui.stack}>
    {steps.map((step, index) => <View key={step.title} style={ui.stack}>
      {index > 0 && <Divider />}
      <Text style={ui.label}>{step.title}</Text>
      <Text style={ui.body}>{step.detail}</Text>
    </View>)}
  </View>;
}

export function FirstBillGuide({ onDismiss }: { onDismiss: () => void }) {
  return <Card tone="tonal">
    <SectionHeader>Your first bill review</SectionHeader>
    <BillReviewSteps />
    <Button label="Hide guide" tone="ghost" onPress={onDismiss} />
  </Card>;
}

export function useFirstBillGuide(enabled: boolean) {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!enabled || dismissed) return;
    const control = new AbortController();
    void shouldShowFirstBillGuide(SecureStore, async () => {
      const page = await request<CasePage>('/cases?limit=1', { signal: control.signal });
      return page.cases.length > 0;
    }).then((visible) => {
      if (!control.signal.aborted) setShow(visible);
    }).catch(() => {
      if (!control.signal.aborted) setShow(false);
    });
    return () => control.abort();
  }, [dismissed, enabled]);

  function dismiss() {
    setDismissed(true);
    void finishFirstBillGuide(SecureStore).catch(() => undefined);
  }

  return { visible: enabled && !dismissed && show, dismiss };
}
