import weights from './case-intent-weights.json';

const stopwords = new Set('a an are as at be by can could do for from get how i is it me my of on or please should that the them these this to was were what when where which who will with would you your'.split(' '));

const model: {
  weights: Record<string, number>;
  centroids: Record<string, Record<string, number>>;
} = weights;

export type Intent = keyof typeof weights.centroids | 'unknown';

export function classifyRequest(text: string): { intent: Intent; confidence: number } {
  const words = (text.slice(0, 240).toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => !stopwords.has(word));
  const features = new Set(words);
  for (const word of words) {
    const padded = `^${word}$`;
    for (let index = 0; index + 3 <= padded.length; index += 1) {
      features.add(`~${padded.slice(index, index + 3)}`);
    }
  }
  const entries = [...features].flatMap((term) => {
    if (!Object.prototype.hasOwnProperty.call(model.weights, term)) return [];
    return [[term, model.weights[term]! * (term.startsWith('~') ? 0.45 : 1)] as const];
  });
  const size = Math.hypot(...entries.map(([, weight]) => weight));
  if (!size) return { intent: 'unknown', confidence: 0 };
  const [best, next] = Object.entries(model.centroids).map(([label, vector]) => ({
    label: label as Intent,
    score: entries.reduce((sum, [term, weight]) => sum + weight * (vector[term] ?? 0), 0) / size,
  })).sort((left, right) => right.score - left.score);
  if (!best || best.score < 0.26 || best.score - (next?.score ?? 0) < 0.045) {
    return { intent: 'unknown', confidence: best?.score ?? 0 };
  }
  return { intent: best.label, confidence: best.score };
}
