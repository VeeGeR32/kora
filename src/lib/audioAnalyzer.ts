import type { LyricsBarBlock, MusicTrack } from '../types';

export interface TrackAudioAnalysis {
  durationSec: number;
  bpm: number;
  musicalKey: string;
  barOffsetSec: number;
  barBlockEnergies: number[]; // 0..100 integer per 4-bar block
  analyzedAt: string;
}

export interface ComputedBarBlock {
  index: number;
  startBar: number;
  endBar: number;
  startSec: number;
  endSec: number;
  energy: number; // 0..100
  suggestedSection: string;
}

// Krumhansl-Schmuckler tonal hierarchy profiles (C=0 .. B=11)
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den > 0 ? num / den : 0;
}

/**
 * Fast Goertzel-based 12-pitch-class chromagram + Krumhansl-Schmuckler Key detector.
 * Samples ~80 evenly spaced frames across the body of the song (runs in ~15ms).
 */
function detectMusicalKey(mono: Float32Array, sampleRate: number): string {
  const totalSamples = mono.length;
  if (totalSamples < sampleRate * 2) return '';

  // Decimate to ~11025 Hz for crisp harmonic resolution up to ~5 kHz at 4x speed
  const dec = Math.max(1, Math.round(sampleRate / 11025));
  const effRate = sampleRate / dec;

  const frameSize = 2048;
  const startIdx = Math.floor(totalSamples * 0.15);
  const endIdx = Math.floor(totalSamples * 0.85);
  const span = Math.max(frameSize * dec, endIdx - startIdx);
  const numFrames = 72;
  const step = Math.max(frameSize * dec, Math.floor(span / numFrames));

  // Precompute Hann window
  const hann = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1)));
  }

  // Precompute Goertzel coefficients for MIDI notes 36 (C2 ~65Hz) through 83 (B5 ~988Hz)
  const freqs: Array<{ pc: number; coeff: number; weight: number }> = [];
  for (let midi = 36; midi <= 83; midi++) {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    if (freq >= effRate * 0.45) continue;
    const omega = (2 * Math.PI * freq) / effRate;
    // Slight mid-range weighting where chords/melodies live most clearly (C3..B4)
    const weight = midi >= 48 && midi <= 72 ? 1.25 : 0.85;
    freqs.push({ pc: midi % 12, coeff: 2 * Math.cos(omega), weight });
  }

  const chroma = new Array<number>(12).fill(0);
  const frameBuf = new Float32Array(frameSize);

  for (let pos = startIdx; pos + frameSize * dec < endIdx; pos += step) {
    let rms = 0;
    for (let i = 0; i < frameSize; i++) {
      const s = mono[pos + i * dec] * hann[i];
      frameBuf[i] = s;
      rms += s * s;
    }
    if (rms < 1e-4) continue; // skip silent frames

    for (let f = 0; f < freqs.length; f++) {
      const { pc, coeff, weight } = freqs[f];
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < frameSize; i++) {
        const s0 = frameBuf[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
      if (power > 0) {
        chroma[pc] += Math.sqrt(power) * weight;
      }
    }
  }

  const chromaSum = chroma.reduce((a, b) => a + b, 0);
  if (chromaSum <= 0) return '';

  let bestScore = -Infinity;
  let bestKey = '';

  for (let root = 0; root < 12; root++) {
    const rotated = new Array<number>(12);
    for (let i = 0; i < 12; i++) {
      rotated[i] = chroma[(i + root) % 12];
    }
    const majScore = pearsonCorrelation(rotated, MAJOR_PROFILE);
    if (majScore > bestScore) {
      bestScore = majScore;
      bestKey = NOTE_NAMES[root];
    }
    const minScore = pearsonCorrelation(rotated, MINOR_PROFILE);
    if (minScore > bestScore) {
      bestScore = minScore;
      bestKey = `${NOTE_NAMES[root]}m`;
    }
  }

  return bestKey;
}

/**
 * Robust onset-envelope + autocorrelation BPM & bar-1 downbeat phase detector.
 * Tuned for hip-hop / trap / drill / pop / Afrobeat (72..166 BPM musical range).
 */
function detectBpmAndOffset(
  mono: Float32Array,
  sampleRate: number
): { bpm: number; barOffsetSec: number } {
  const durationSec = mono.length / sampleRate;
  if (durationSec < 4) {
    return { bpm: 120, barOffsetSec: 0 };
  }

  // Hop size ~10ms -> ~100 frames/sec onset envelope
  const hopSize = Math.max(256, Math.round(sampleRate * 0.01));
  const frameRate = sampleRate / hopSize;
  const totalFrames = Math.floor(mono.length / hopSize);

  // Simple 1-pole low-pass (~220Hz) to highlight kick/bass transients + fullband for snare/hats
  const lpAlpha = Math.min(1, (2 * Math.PI * 220) / sampleRate);
  let lpState = 0;

  const lowEnergy = new Float32Array(totalFrames);
  const fullEnergy = new Float32Array(totalFrames);

  for (let f = 0; f < totalFrames; f++) {
    const base = f * hopSize;
    let sumLow = 0;
    let sumFull = 0;
    for (let i = 0; i < hopSize; i++) {
      const s = mono[base + i];
      lpState += lpAlpha * (s - lpState);
      sumLow += lpState * lpState;
      sumFull += s * s;
    }
    lowEnergy[f] = Math.sqrt(sumLow / hopSize);
    fullEnergy[f] = Math.sqrt(sumFull / hopSize);
  }

  // Half-wave rectified first-order difference = onset strength curve
  const onset = new Float32Array(totalFrames);
  for (let f = 1; f < totalFrames; f++) {
    const dLow = Math.max(0, lowEnergy[f] - lowEnergy[f - 1]);
    const dFull = Math.max(0, fullEnergy[f] - fullEnergy[f - 1]);
    onset[f] = dLow * 1.8 + dFull * 0.7;
  }

  // Subtract local moving average (~0.3s) for crisp rhythmic peaks
  const win = Math.max(4, Math.round(frameRate * 0.3));
  const cleanOnset = new Float32Array(totalFrames);
  let running = 0;
  for (let f = 0; f < totalFrames; f++) {
    running += onset[f];
    if (f >= win) running -= onset[f - win];
    const avg = running / Math.min(win, f + 1);
    cleanOnset[f] = Math.max(0, onset[f] - avg * 1.15);
  }

  // Analyze the rhythmic body (skip first 8% & last 8%, max 90s for fast CPU)
  const bodyStart = Math.floor(totalFrames * 0.08);
  const bodyEnd = Math.min(Math.floor(totalFrames * 0.92), bodyStart + Math.round(frameRate * 90));
  const bodyLen = Math.max(1, bodyEnd - bodyStart);

  // Autocorrelation over lags corresponding to 68..172 BPM
  const minLag = Math.max(10, Math.floor((60 / 172) * frameRate));
  const maxLag = Math.min(Math.floor(bodyLen / 2), Math.ceil((60 / 68) * frameRate));

  let bestLag = Math.round((60 / 120) * frameRate);
  let bestScore = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    const limit = bodyEnd - lag;
    for (let i = bodyStart; i < limit; i++) {
      corr += cleanOnset[i] * cleanOnset[i + lag];
    }
    corr /= Math.max(1, limit - bodyStart);

    // Check harmonic reinforcement at 2*lag (half-bar / 2 beats) and 4*lag (1 full bar)
    let barBonus = 0;
    if (bodyStart + lag * 2 < bodyEnd) {
      let c2 = 0;
      const lim2 = bodyEnd - lag * 2;
      for (let i = bodyStart; i < lim2; i += 2) {
        c2 += cleanOnset[i] * cleanOnset[i + lag * 2];
      }
      barBonus = (c2 / Math.max(1, (lim2 - bodyStart) / 2)) * 0.35;
    }

    const candidateBpm = (60 * frameRate) / lag;
    // Gentle Gaussian prior around 124 BPM (covers 75..160 cleanly without bias toward extremes)
    const prior = Math.exp(-0.5 * Math.pow((Math.log2(candidateBpm / 124)) / 0.55, 2));
    const score = (corr + barBonus) * (0.7 + 0.3 * prior);

    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  let bpm = Math.round((60 * frameRate) / bestLag);
  while (bpm < 72) bpm *= 2;
  while (bpm > 168) bpm = Math.round(bpm / 2);

  // Detect Bar 1 offset:
  // 1. Find first non-silent audio onset (skip leading silence < 6% of peak energy)
  let peakFull = 0;
  for (let f = 0; f < totalFrames; f++) {
    if (fullEnergy[f] > peakFull) peakFull = fullEnergy[f];
  }
  const silenceThresh = peakFull * 0.06;
  let firstSoundFrame = 0;
  for (let f = 0; f < totalFrames; f++) {
    if (fullEnergy[f] >= silenceThresh) {
      firstSoundFrame = f;
      break;
    }
  }

  // 2. Refine phase within 1 beat window to align grid to strongest beats
  const beatFrames = (60 / bpm) * frameRate;
  const searchEnd = Math.min(totalFrames, firstSoundFrame + Math.round(frameRate * 45));
  let bestPhase = firstSoundFrame % beatFrames;
  let bestPhaseScore = -1;
  const phaseSteps = Math.max(8, Math.round(beatFrames));
  for (let p = 0; p < phaseSteps; p++) {
    const phase = (p / phaseSteps) * beatFrames;
    let sum = 0;
    let count = 0;
    for (let f = firstSoundFrame + phase; f < searchEnd; f += beatFrames) {
      const idx = Math.round(f);
      if (idx >= 0 && idx < totalFrames) {
        sum += cleanOnset[idx];
        count++;
      }
    }
    const avg = count > 0 ? sum / count : 0;
    if (avg > bestPhaseScore) {
      bestPhaseScore = avg;
      bestPhase = phase;
    }
  }

  let barOffsetSec = (firstSoundFrame + bestPhase) / frameRate;
  // Snap tiny offsets (< 0.18s) cleanly to 0:00 so M1 starts naturally at 0:00
  if (barOffsetSec < 0.18) barOffsetSec = 0;
  barOffsetSec = Math.round(barOffsetSec * 100) / 100;

  return { bpm, barOffsetSec };
}

/** Computes normalized 0..100 RMS energy for every 4-bar block across the song */
export function computeBlockEnergiesFromMono(
  mono: Float32Array,
  sampleRate: number,
  bpm: number,
  barOffsetSec: number
): number[] {
  const durationSec = mono.length / sampleRate;
  const safeBpm = Math.max(50, Math.min(240, bpm || 120));
  const blockDurSec = (4 * 4 * 60) / safeBpm; // 4 bars of 4/4
  if (blockDurSec <= 0 || durationSec <= 0) return [];

  const rawEnergies: number[] = [];
  for (let t = Math.max(0, barOffsetSec); t < durationSec - 0.5; t += blockDurSec) {
    const startSample = Math.floor(t * sampleRate);
    const endSample = Math.min(mono.length, Math.floor((t + blockDurSec) * sampleRate));
    if (endSample <= startSample) break;
    // Stride by 8 samples for super fast RMS (~2ms)
    let sumSq = 0;
    let count = 0;
    for (let i = startSample; i < endSample; i += 8) {
      const s = mono[i];
      sumSq += s * s;
      count++;
    }
    rawEnergies.push(count > 0 ? Math.sqrt(sumSq / count) : 0);
  }

  const maxE = Math.max(0.0001, ...rawEnergies);
  return rawEnergies.map((e) => Math.max(5, Math.min(100, Math.round((e / maxE) * 100))));
}

/**
 * Full client-side audio analyzer: decodes an audio URL (Blob / Drive ObjectURL / HTTP URL)
 * via Web Audio API and returns BPM, musical Key, Bar 1 offset, and 4-bar block energies.
 */
export async function analyzeTrackAudioUrl(audioUrl: string): Promise<TrackAudioAnalysis> {
  const res = await fetch(audioUrl);
  if (!res.ok) {
    throw new Error(`Impossible de lire l’audio (${res.status})`);
  }
  const arrayBuf = await res.arrayBuffer();
  const AudioCtx =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
    const durationSec = Math.round(audioBuf.duration * 100) / 100;
    const sampleRate = audioBuf.sampleRate;
    const ch0 = audioBuf.getChannelData(0);
    let mono: Float32Array;
    if (audioBuf.numberOfChannels > 1) {
      const ch1 = audioBuf.getChannelData(1);
      mono = new Float32Array(ch0.length);
      for (let i = 0; i < ch0.length; i++) {
        mono[i] = (ch0[i] + ch1[i]) * 0.5;
      }
    } else {
      mono = ch0;
    }

    const { bpm, barOffsetSec } = detectBpmAndOffset(mono, sampleRate);
    const musicalKey = detectMusicalKey(mono, sampleRate);
    const barBlockEnergies = computeBlockEnergiesFromMono(mono, sampleRate, bpm, barOffsetSec);

    return {
      durationSec,
      bpm,
      musicalKey,
      barOffsetSec,
      barBlockEnergies,
      analyzedAt: new Date().toISOString(),
    };
  } finally {
    void ctx.close().catch(() => {});
  }
}

/** Suggests musical section labels (Intro / Couplet / Refrain / Pont / Outro) from 4-bar energy curve */
export function suggestSectionLabelForBlock(
  index: number,
  total: number,
  energies: number[]
): string {
  const e = energies[index] ?? 65;
  if (total <= 1) return 'Couplet';
  if (index === 0 && e < 62) return 'Intro';
  if (index === 1 && (energies[0] ?? 50) < 55 && e < 58) return 'Intro';
  if (index === total - 1 && e < 64) return 'Outro';
  if (index === total - 2 && (energies[total - 1] ?? 50) < 55 && e < 55) return 'Outro';
  if (e >= 78) return 'Refrain';
  if (index > 2 && index < total - 2 && e < 52) return 'Pont';
  return 'Couplet';
}

/**
 * Pure deterministic 4-bar grid calculator from track metadata (`durationSec`, `bpm`, `barOffsetSec`, `barBlockEnergies`).
 * Instant recalculation whenever user clicks ÷2 / ×2 / adjusts BPM or moves Bar 1 offset!
 */
export function computeFourBarGrid(
  durationSec: number,
  bpm: number,
  barOffsetSec = 0,
  barBlockEnergies?: number[]
): ComputedBarBlock[] {
  const safeDur = Math.max(8, durationSec || 120);
  const safeBpm = Math.max(50, Math.min(240, bpm || 120));
  const safeOffset = Math.max(0, Math.min(safeDur - 4, barOffsetSec || 0));
  const barDur = (4 * 60) / safeBpm;
  const blockDur = barDur * 4; // 4 bars per block

  const totalBlocks = Math.max(1, Math.min(80, Math.ceil((safeDur - safeOffset) / blockDur)));
  const energies: number[] = [];
  for (let i = 0; i < totalBlocks; i++) {
    if (barBlockEnergies && barBlockEnergies.length > 0) {
      // Smoothly resample energy array if user changed BPM (÷2 / ×2)
      const ratio = totalBlocks > 1 ? i / (totalBlocks - 1) : 0;
      const srcIdx = Math.min(
        barBlockEnergies.length - 1,
        Math.round(ratio * (barBlockEnergies.length - 1))
      );
      energies.push(barBlockEnergies[srcIdx]);
    } else {
      energies.push(60);
    }
  }

  const blocks: ComputedBarBlock[] = [];
  for (let i = 0; i < totalBlocks; i++) {
    const startSec = safeOffset + i * blockDur;
    const endSec = Math.min(safeDur, startSec + blockDur);
    blocks.push({
      index: i,
      startBar: i * 4 + 1,
      endBar: i * 4 + 4,
      startSec,
      endSec,
      energy: energies[i],
      suggestedSection: suggestSectionLabelForBlock(i, totalBlocks, energies),
    });
  }
  return blocks;
}

/**
 * Merges computed 4-bar grid with any existing `barBlocks` (or existing freeform `content`),
 * guaranteeing ZERO data loss when a track is linked or its BPM is tweaked!
 */
export function syncBarBlocksWithGrid(
  grid: ComputedBarBlock[],
  existingBlocks?: LyricsBarBlock[],
  legacyContent?: string
): LyricsBarBlock[] {
  if (existingBlocks && existingBlocks.length > 0) {
    const byIndex = new Map(existingBlocks.map((b) => [b.index, b]));
    const result: LyricsBarBlock[] = grid.map((g) => {
      const prev = byIndex.get(g.index);
      if (prev) {
        return {
          ...prev,
          index: g.index,
          sectionLabel: prev.sectionLabel || g.suggestedSection,
        };
      }
      return {
        id: `blk_${g.index}`,
        index: g.index,
        sectionLabel: g.suggestedSection,
        status: 'empty',
        text: '',
      };
    });
    // Preserve any text that lived in extra blocks beyond the new grid length (e.g. after ÷2)
    const overflowTexts = existingBlocks
      .filter((b) => b.index >= grid.length && b.text.trim().length > 0)
      .map((b) => b.text.trim());
    if (overflowTexts.length > 0 && result.length > 0) {
      const last = result[result.length - 1];
      last.text = [last.text.trim(), ...overflowTexts].filter(Boolean).join('\n');
      if (last.status === 'empty') last.status = 'draft';
    }
    return result;
  }

  // First-time automatic division: preserve any existing freeform paragraphs cleanly!
  const paragraphs = (legacyContent || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  // If intro block looks instrumental and there are fewer paragraphs than blocks, start placing lyrics after intro
  let startInsertIdx = 0;
  if (paragraphs.length > 0 && grid.length > paragraphs.length && grid[0]?.suggestedSection === 'Intro') {
    startInsertIdx = 1;
  }

  return grid.map((g, idx) => {
    const pIdx = idx - startInsertIdx;
    const rawPara = pIdx >= 0 && pIdx < paragraphs.length ? paragraphs[pIdx] : '';
    // Extract optional leading [Section] header from legacy paragraph (NEVER treat [FIX] tags as a section name!)
    let sectionLabel = g.suggestedSection;
    let text = rawPara;
    const headerMatch = rawPara.match(/^\[([^\]]+)\]\s*\n?([\s\S]*)$/);
    if (headerMatch && !/^FIX(?::|$)/i.test(headerMatch[1].trim())) {
      sectionLabel = headerMatch[1].trim() || sectionLabel;
      text = (headerMatch[2] || '').trim();
    }
    // If legacy content had MORE paragraphs than blocks, append extras to the last block so nothing is ever lost
    if (idx === grid.length - 1 && paragraphs.length > grid.length - startInsertIdx) {
      const extras = paragraphs.slice(grid.length - startInsertIdx);
      text = [text, ...extras].filter(Boolean).join('\n\n');
    }
    return {
      id: `blk_${g.index}`,
      index: g.index,
      sectionLabel,
      status: text.trim().length > 0 ? 'draft' : 'empty',
      text,
    };
  });
}

/**
 * Serializes 4-bar blocks back into clean `doc.content` plain text so word count, [FIX] badges,
 * global search, markdown preview, and backups stay 100% in sync automatically!
 */
export function serializeBarBlocksToContent(blocks: LyricsBarBlock[]): string {
  const chunks: string[] = [];
  let lastSection = '';

  for (const blk of blocks) {
    const startBar = blk.index * 4 + 1;
    const endBar = blk.index * 4 + 4;
    const hasText = blk.text.trim().length > 0;
    const isPlanned = blk.status === 'planned';
    if (!hasText && !isPlanned) continue;

    const sec = (blk.sectionLabel || '').trim();
    const lines: string[] = [];
    if (sec && sec !== lastSection) {
      lines.push(`[${sec}]`);
      lastSection = sec;
    }
    if (hasText) {
      lines.push(blk.text.trim());
    } else if (isPlanned) {
      const cue = blk.note?.trim() ? ` — ${blk.note.trim()}` : '';
      lines.push(`[À écrire · M${startBar}–M${endBar}${cue}]`);
    }
    chunks.push(lines.join('\n'));
  }

  return chunks.join('\n\n');
}

/** Helper to check if a track already has complete automatic BPM/Key/Bar analysis */
export function isTrackAnalyzed(track?: MusicTrack | null): boolean {
  if (!track) return false;
  return Boolean(
    track.audioAnalyzedAt &&
      typeof track.bpm === 'number' &&
      track.bpm > 0 &&
      Array.isArray(track.barBlockEnergies) &&
      track.barBlockEnergies.length > 0
  );
}
