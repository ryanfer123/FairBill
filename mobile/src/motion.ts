import { Easing, FadeIn, ReduceMotion } from 'react-native-reanimated';

export const evidenceReveal = FadeIn.duration(170).easing(Easing.out(Easing.cubic)).reduceMotion(ReduceMotion.System);
