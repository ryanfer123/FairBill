import { Easing, FadeInDown, ReduceMotion } from 'react-native-reanimated';

const reveal = (distance: number, duration: number) => FadeInDown
  .withInitialValues({ opacity: 0, transform: [{ translateY: distance }] })
  .duration(duration).easing(Easing.out(Easing.cubic)).reduceMotion(ReduceMotion.System);

export const evidenceReveal = reveal(4, 165);
export const surfaceReveal = reveal(8, 215);
export const highlightReveal = reveal(10, 260);
export const dockTiming = { duration: 210, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System };
