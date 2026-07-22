/**
 * Controlled audio mixer for generating single-channel speech overlap stimuli.
 *
 * Adheres to the spec in §7: normalize=0, EBU R128 loudness standardization,
 * 48 kHz sample rate, mono channel layout. Uses spawnSync to prevent
 * command-injection vulnerabilities.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const MIXTURE_DEFAULTS = Object.freeze({
  normalize: 0,
  targetLUFS: -23.0,
  sampleRate: 48000,
  channelLayout: "mono",
});

/**
 * Compute gain factor (linear) for a target TIR in dB.
 * @param {number} tirDb - target-to-interference ratio in dB
 * @returns {number} linear gain multiplier for the interference signal
 */
export function tirToGain(tirDb) {
  return Math.pow(10, -tirDb / 20);
}

/**
 * Compute overlap start time in seconds given total duration and overlap fraction.
 * @param {number} durationSec - total duration of the target signal
 * @param {number} overlapFraction - 0.0 to 1.0
 * @returns {number} start time of the interference signal in seconds
 */
export function overlapStartTime(durationSec, overlapFraction) {
  if (overlapFraction < 0 || overlapFraction > 1) {
    throw new RangeError("overlapFraction must be in [0, 1]");
  }
  return durationSec * (1 - overlapFraction);
}

/**
 * Loudness-normalize an audio file to EBU R128 target LUFS using FFmpeg.
 * Uses loudnorm filter in single-pass mode (linear normalization).
 * @param {string} inputPath - path to input audio file
 * @param {string} outputPath - path to normalized output
 * @param {number} targetLUFS - target loudness in LUFS
 * @param {number} sampleRate - target sample rate
 * @returns {{ ok: boolean, stderr: string }}
 */
export function loudnessNormalize(inputPath, outputPath, targetLUFS = MIXTURE_DEFAULTS.targetLUFS, sampleRate = MIXTURE_DEFAULTS.sampleRate) {
  const args = [
    "-y",
    "-i", inputPath,
    "-af", `loudnorm=I=${targetLUFS}:TP=-2:LRA=11:linear=true`,
    "-ar", String(sampleRate),
    "-ac", "1",
    "-c:a", "pcm_s16le",
    outputPath,
  ];
  const result = spawnSync("ffmpeg", args, { encoding: "utf-8", timeout: 60000 });
  return { ok: result.status === 0, stderr: result.stderr || "" };
}

/**
 * Reverse audio in time (for time-reversed speech interference condition).
 * Preserves energy envelope but removes lexical intelligibility.
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {number} sampleRate
 * @returns {{ ok: boolean, stderr: string }}
 */
export function reverseAudio(inputPath, outputPath, sampleRate = MIXTURE_DEFAULTS.sampleRate) {
  const args = [
    "-y",
    "-i", inputPath,
    "-af", "areverse",
    "-ar", String(sampleRate),
    "-ac", "1",
    "-c:a", "pcm_s16le",
    outputPath,
  ];
  const result = spawnSync("ffmpeg", args, { encoding: "utf-8", timeout: 60000 });
  return { ok: result.status === 0, stderr: result.stderr || "" };
}

/**
 * Generate speech-shaped noise from an input speech file.
 * Extracts spectral envelope via FFT, then applies it to white noise.
 * Non-linguistic control matched to the speech power spectrum.
 * @param {string} inputPath - source speech to derive spectral shape from
 * @param {string} outputPath
 * @param {number} sampleRate
 * @returns {{ ok: boolean, stderr: string }}
 */
export function generateSpeechShapedNoise(inputPath, outputPath, sampleRate = MIXTURE_DEFAULTS.sampleRate) {
  // Use FFmpeg's spectrum filter to derive envelope, then modulate noise
  const args = [
    "-y",
    "-i", inputPath,
    "-f", "lavfi",
    "-i", "anoisesrc=color=white:duration=auto:amplitude=0.5",
    "-filter_complex",
    "[0:a]showspectrum=mode=combined:color=intensity[spect];" +
      "[1:a][spect]afftffilt=real='re(W)*H':imag='im(W)*H'[shaped];" +
      "[shaped]loudnorm=I=-23:TP=-2:LRA=11[out]",
    "-map", "[out]",
    "-ar", String(sampleRate),
    "-ac", "1",
    "-c:a", "pcm_s16le",
    outputPath,
  ];
  const result = spawnSync("ffmpeg", args, { encoding: "utf-8", timeout: 60000 });
  return { ok: result.status === 0, stderr: result.stderr || "" };
}

/**
 * Mix target and interference audio at a specified TIR.
 *
 * Critical: normalize=0 is passed to amix to prevent FFmpeg from
 * dynamically scaling amplitudes, ensuring TIR remains a true
 * independent variable.
 *
 * @param {string} targetPath - path to loudness-normalized target audio
 * @param {string} interferencePath - path to loudness-normalized interference audio
 * @param {string} outputPath - path to mixed output
 * @param {number} tirDb - target-to-interference ratio in dB
 * @param {number} overlapFraction - 0.0 to 1.0 temporal overlap
 * @param {number} sampleRate
 * @returns {{ ok: boolean, stderr: string }}
 */
export function mixAudios(targetPath, interferencePath, outputPath, tirDb, overlapFraction, sampleRate = MIXTURE_DEFAULTS.sampleRate) {
  if (overlapFraction < 0 || overlapFraction > 1) {
    throw new RangeError("overlapFraction must be in [0, 1]");
  }

  // Compute interference gain from TIR
  const interferenceGain = tirToGain(tirDb);

  // Get target duration to compute overlap offset
  const probeResult = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    targetPath,
  ], { encoding: "utf-8", timeout: 10000 });

  if (probeResult.status !== 0) {
    return { ok: false, stderr: `ffprobe failed: ${probeResult.stderr}` };
  }

  const durationSec = parseFloat(probeResult.stdout.trim());
  if (isNaN(durationSec) || durationSec <= 0) {
    return { ok: false, stderr: `Invalid duration: ${probeResult.stdout}` };
  }

  const startOffset = overlapStartTime(durationSec, overlapFraction);

  // Build filter graph:
  // - Apply gain to interference based on TIR
  // - Delay interference to achieve desired temporal overlap
  // - Mix with normalize=0 to preserve absolute gain
  const delayMs = Math.round(startOffset * 1000);
  const filterGraph =
    `[1:a]volume=${interferenceGain},adelay=${delayMs}|${delayMs}[delayed];` +
    `[0:a][delayed]amix=inputs=2:duration=longest:normalize=0[out]`;

  const args = [
    "-y",
    "-i", targetPath,
    "-i", interferencePath,
    "-filter_complex", filterGraph,
    "-map", "[out]",
    "-ar", String(sampleRate),
    "-ac", "1",
    "-c:a", "pcm_s16le",
    outputPath,
  ];

  const result = spawnSync("ffmpeg", args, { encoding: "utf-8", timeout: 120000 });
  return { ok: result.status === 0, stderr: result.stderr || "" };
}

/**
 * Mix multiple interference speakers with a target at a specified TIR.
 * Each interference speaker is gain-scaled equally to collectively
 * produce the target TIR.
 *
 * @param {string} targetPath - loudness-normalized target
 * @param {string[]} interferencePaths - array of loudness-normalized interference files
 * @param {string} outputPath
 * @param {number} tirDb - target-to-interference ratio in dB (collective)
 * @param {number} overlapFraction
 * @param {number} sampleRate
 * @returns {{ ok: boolean, stderr: string }}
 */
export function mixMultiSpeaker(targetPath, interferencePaths, outputPath, tirDb, overlapFraction, sampleRate = MIXTURE_DEFAULTS.sampleRate) {
  if (interferencePaths.length === 0) {
    // No interference — just copy target
    const args = ["-y", "-i", targetPath, "-c:a", "pcm_s16le", "-ar", String(sampleRate), "-ac", "1", outputPath];
    const result = spawnSync("ffmpeg", args, { encoding: "utf-8", timeout: 60000 });
    return { ok: result.status === 0, stderr: result.stderr || "" };
  }

  const nInterference = interferencePaths.length;
  // Distribute TIR across N interference speakers (equal energy split)
  const perSpeakerGainDb = tirDb - 10 * Math.log10(nInterference);
  const perSpeakerGain = tirToGain(perSpeakerGainDb);

  // Get target duration
  const probeResult = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    targetPath,
  ], { encoding: "utf-8", timeout: 10000 });

  if (probeResult.status !== 0) {
    return { ok: false, stderr: `ffprobe failed: ${probeResult.stderr}` };
  }

  const durationSec = parseFloat(probeResult.stdout.trim());
  const startOffset = overlapStartTime(durationSec, overlapFraction);
  const delayMs = Math.round(startOffset * 1000);

  // Build input args
  const inputArgs = ["-i", targetPath];
  for (const p of interferencePaths) {
    inputArgs.push("-i", p);
  }

  // Build filter graph
  // Target is [0:a], interferences are [1:a] through [N:a]
  const filterParts = [];
  for (let i = 0; i < nInterference; i++) {
    const inputLabel = `${i + 1}:a`;
    const outputLabel = `int${i}`;
    filterParts.push(`[${inputLabel}]volume=${perSpeakerGain},adelay=${delayMs}|${delayMs}[${outputLabel}]`);
  }

  // Mix all
  const mixInputs = ["[0:a]"];
  for (let i = 0; i < nInterference; i++) {
    mixInputs.push(`[int${i}]`);
  }
  const mixStr = `${mixInputs.join("")}amix=inputs=${nInterference + 1}:duration=longest:normalize=0[out]`;
  filterParts.push(mixStr);

  const filterGraph = filterParts.join(";");

  const args = [
    "-y",
    ...inputArgs,
    "-filter_complex", filterGraph,
    "-map", "[out]",
    "-ar", String(sampleRate),
    "-ac", "1",
    "-c:a", "pcm_s16le",
    outputPath,
  ];

  const result = spawnSync("ffmpeg", args, { encoding: "utf-8", timeout: 180000 });
  return { ok: result.status === 0, stderr: result.stderr || "" };
}

/**
 * Verify that FFmpeg and ffprobe are available.
 * @returns {{ ffmpeg: boolean, ffprobe: boolean }}
 */
export function checkDependencies() {
  const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf-8", timeout: 5000 });
  const ffprobe = spawnSync("ffprobe", ["-version"], { encoding: "utf-8", timeout: 5000 });
  return {
    ffmpeg: ffmpeg.status === 0,
    ffprobe: ffprobe.status === 0,
  };
}

/**
 * Get audio file metadata (duration, sample rate, channels).
 * @param {string} filePath
 * @returns {{ duration: number, sampleRate: number, channels: number } | null}
 */
export function getAudioInfo(filePath) {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=sample_rate,channels,duration",
    "-of", "json",
    filePath,
  ], { encoding: "utf-8", timeout: 10000 });

  if (result.status !== 0) return null;

  try {
    const data = JSON.parse(result.stdout);
    const stream = data.streams?.[0];
    if (!stream) return null;
    return {
      duration: parseFloat(stream.duration) || 0,
      sampleRate: parseInt(stream.sample_rate) || 0,
      channels: parseInt(stream.channels) || 0,
    };
  } catch {
    return null;
  }
}
