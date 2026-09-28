import type { ModelOutput, Regime, MPSWeights } from '../types';

const FALLBACK_WEIGHTS: MPSWeights = {
  agreement: 0.32,
  confidence: 0.22,
  regimeFit: 0.18,
  timeConsistency: 0.15,
  peerConfirmation: 0.13,
};

const SIGMOID_SHARPNESS = 8.5;
const SIGMOID_MIDPOINT = 0.55;

export function loadMPSWeights(env?: Record<string, unknown>): MPSWeights {
  if (!env?.MIZAN_MPS_WEIGHTS) return FALLBACK_WEIGHTS;
  try {
    const raw =
      typeof env.MIZAN_MPS_WEIGHTS === 'string'
        ? JSON.parse(env.MIZAN_MPS_WEIGHTS as string)
        : env.MIZAN_MPS_WEIGHTS;
    const w = raw as Partial<MPSWeights>;
    if (
      typeof w.agreement === 'number' &&
      typeof w.confidence === 'number' &&
      typeof w.regimeFit === 'number' &&
      typeof w.timeConsistency === 'number' &&
      typeof w.peerConfirmation === 'number'
    ) {
      const sum =
        w.agreement + w.confidence + w.regimeFit + w.timeConsistency + w.peerConfirmation;
      if (Math.abs(sum - 1) < 0.01) return w as MPSWeights;
    }
  } catch {
    // تجاهل env مشوَّه — نرجع للافتراضي بدل رمي الخطأ.
  }
  return FALLBACK_WEIGHTS;
}

function computeAgreement(outputs: ModelOutput[]): {
  score: number;
  dominantDirection: 'up' | 'down' | 'neutral';
  dominantCount: number;
} {
  if (!outputs.length) {
    return { score: 0, dominantDirection: 'neutral', dominantCount: 0 };
  }
  const counts = { up: 0, down: 0, neutral: 0 };
  for (const o of outputs) counts[o.direction]++;
  const dominant = (
    Object.entries(counts) as Array<['up' | 'down' | 'neutral', number]>
  ).sort((a, b) => b[1] - a[1])[0];
  const totalDirectional = counts.up + counts.down;
  const score =
    totalDirectional > 0 ? Math.max(counts.up, counts.down) / totalDirectional : 0;
  return { score, dominantDirection: dominant[0], dominantCount: dominant[1] };
}

function computeConfidence(outputs: ModelOutput[], weights: Record<string, number>): number {
  let num = 0;
  let den = 0;
  for (const o of outputs) {
    const w = weights[o.modelId] ?? 0;
    num += w * o.confidence;
    den += w;
  }
  return den > 0 ? num / den : 0;
}

/** جودة كل حالة نظام كثقة مسبقة، مستقلة عن اسم Regime — تُستهلك عبر posterior فقط. */
function computeRegimeFit(posterior: [number, number, number, number]): number {
  const stateQuality = [0.95, 0.65, 0.55, 0.25];
  let score = 0;
  for (let i = 0; i < 4; i++) score += posterior[i] * stateQuality[i];
  return score;
}

function computeTimeConsistency(
  multiHorizonSignals: Array<{ horizon: number; direction: 'up' | 'down' | 'neutral' }>,
): number {
  if (multiHorizonSignals.length < 2) return 0.5;
  const directional = multiHorizonSignals.filter((s) => s.direction !== 'neutral');
  if (!directional.length) return 0.3;
  const ups = directional.filter((s) => s.direction === 'up').length;
  const downs = directional.filter((s) => s.direction === 'down').length;
  const maxSame = Math.max(ups, downs);
  return maxSame / multiHorizonSignals.length;
}

function computePeerConfirmation(
  peers: Array<{ direction: 'up' | 'down' | 'neutral' }>,
  myDirection: 'up' | 'down' | 'neutral',
): number {
  if (!peers.length || myDirection === 'neutral') return 0.5;
  const same = peers.filter((p) => p.direction === myDirection).length;
  return same / peers.length;
}

export type MPSInput = {
  outputs: ModelOutput[];
  weights: Record<string, number>;
  regime: Regime;
  posterior: [number, number, number, number];
  multiHorizonSignals: Array<{ horizon: number; direction: 'up' | 'down' | 'neutral' }>;
  peers: Array<{ direction: 'up' | 'down' | 'neutral' }>;
};

export type MPSResult = {
  mps: number;
  components: {
    agreement: number;
    confidence: number;
    regimeFit: number;
    timeConsistency: number;
    peerConfirmation: number;
  };
  dominantDirection: 'up' | 'down' | 'neutral';
  dominantCount: number;
};

export function computeMPS(
  input: MPSInput,
  weights: MPSWeights = FALLBACK_WEIGHTS,
): MPSResult {
  const agr = computeAgreement(input.outputs);
  const conf = computeConfidence(input.outputs, input.weights);
  const regime = computeRegimeFit(input.posterior);
  const time = computeTimeConsistency(input.multiHorizonSignals);
  const peer = computePeerConfirmation(input.peers, agr.dominantDirection);
  const raw =
    weights.agreement * agr.score +
    weights.confidence * conf +
    weights.regimeFit * regime +
    weights.timeConsistency * time +
    weights.peerConfirmation * peer;
  const mps = 1 / (1 + Math.exp(-SIGMOID_SHARPNESS * (raw - SIGMOID_MIDPOINT)));
  return {
    mps,
    components: {
      agreement: agr.score,
      confidence: conf,
      regimeFit: regime,
      timeConsistency: time,
      peerConfirmation: peer,
    },
    dominantDirection: agr.dominantDirection,
    dominantCount: agr.dominantCount,
  };
}

export function describeMPS(r: MPSResult): string {
  const c = r.components;
  return [
    `MPS=${r.mps.toFixed(4)}`,
    `A=${c.agreement.toFixed(3)}`,
    `C=${c.confidence.toFixed(3)}`,
    `R=${c.regimeFit.toFixed(3)}`,
    `T=${c.timeConsistency.toFixed(3)}`,
    `P=${c.peerConfirmation.toFixed(3)}`,
  ].join(' | ');
}
