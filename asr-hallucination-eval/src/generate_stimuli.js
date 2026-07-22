/**
 * Stimulus generator — produces the full factorial matrix of speech mixtures.
 *
 * Factorial design per §4:
 *   Speaker Count N: 1, 2, 4, 8, 16
 *   TIR: +20, +10, +6, +3, 0, -3 dB
 *   Temporal Overlap: 0%, 25%, 50%, 75%, 100%
 *   Interference Type: intelligible, foreign, time-reversed, speech-shaped noise, silence
 *   Decoder Condition: deterministic, stochastic
 *
 * Output: stimuli/ directory with WAV files and a manifest JSON.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { spawnSync } from "node:child_process";
import {
  MIXTURE_DEFAULTS,
  loudnessNormalize,
  reverseAudio,
  generateSpeechShapedNoise,
  mixAudios,
  mixMultiSpeaker,
  checkDependencies,
  getAudioInfo,
} from "./mix_audios_dynamic.js";

// ─── Factorial matrix definition ─────────────────────────────────────

export const SPEAKER_COUNTS = [1, 2, 4, 8, 16];
export const TIR_LEVELS = [20, 10, 6, 3, 0, -3];
export const OVERLAP_LEVELS = [0.0, 0.25, 0.50, 0.75, 1.0];
export const INTERFERENCE_TYPES = [
  "intelligible",
  "foreign",
  "time_reversed",
  "speech_shaped_noise",
  "silence",
];
export const DECODER_CONDITIONS = ["deterministic", "stochastic"];

/**
 * Generate the full factorial experiment matrix.
 * @returns {object[]} array of condition objects
 */
export function generateFactorialMatrix() {
  const conditions = [];
  for (const nSpeakers of SPEAKER_COUNTS) {
    for (const tir of TIR_LEVELS) {
      for (const overlap of OVERLAP_LEVELS) {
        for (const interferenceType of INTERFERENCE_TYPES) {
          // Skip: N=1 with any interference type other than silence is meaningless
          // (single speaker with interference = the interference IS the second speaker)
          // But we keep N=1 + silence as the clean baseline
          if (nSpeakers === 1 && interferenceType !== "silence") continue;

          for (const decoder of DECODER_CONDITIONS) {
            conditions.push({
              id: `N${nSpeakers}_TIR${tir}_OL${Math.round(overlap * 100)}_${interferenceType}_${decoder}`,
              speakerCount: nSpeakers,
              tirDb: tir,
              overlapFraction: overlap,
              interferenceType,
              decoderCondition: decoder,
            });
          }
        }
      }
    }
  }
  return conditions;
}

/**
 * Prepare a single interference file from a source file based on interference type.
 * @param {string} sourcePath - raw interference audio
 * @param {string} interferenceType - one of INTERFERENCE_TYPES
 * @param {string} workDir - temp directory for intermediate files
 * @param {number} sampleRate
 * @returns {string} path to prepared interference file, or null for silence
 */
export function prepareInterference(sourcePath, interferenceType, workDir, sampleRate = MIXTURE_DEFAULTS.sampleRate) {
  const normalizedPath = join(workDir, `norm_${basename(sourcePath)}`);

  // First normalize the source
  const normResult = loudnessNormalize(sourcePath, normalizedPath, MIXTURE_DEFAULTS.targetLUFS, sampleRate);
  if (!normResult.ok) {
    throw new Error(`Loudness normalization failed: ${normResult.stderr.slice(-200)}`);
  }

  switch (interferenceType) {
    case "intelligible":
    case "foreign":
      return normalizedPath;

    case "time_reversed": {
      const reversedPath = join(workDir, `rev_${basename(sourcePath)}`);
      const revResult = reverseAudio(normalizedPath, reversedPath, sampleRate);
      if (!revResult.ok) {
        throw new Error(`Time reversal failed: ${revResult.stderr.slice(-200)}`);
      }
      return reversedPath;
    }

    case "speech_shaped_noise": {
      const noisePath = join(workDir, `noise_${basename(sourcePath)}`);
      const noiseResult = generateSpeechShapedNoise(normalizedPath, noisePath, sampleRate);
      if (!noiseResult.ok) {
        throw new Error(`Speech-shaped noise generation failed: ${noiseResult.stderr.slice(-200)}`);
      }
      return noisePath;
    }

    case "silence":
      return null;

    default:
      throw new Error(`Unknown interference type: ${interferenceType}`);
  }
}

/**
 * Generate all stimuli for the experiment.
 *
 * @param {object} opts
 * @param {string} opts.targetAudio - path to target speaker audio
 * @param {string[]} opts.interferenceAudioPool - pool of interference speaker audio files
 * @param {string} opts.outputDir - directory to write stimuli
 * @param {number} [opts.sampleRate] - sample rate (default 48000)
 * @param {number} [opts.maxStimuli] - limit number of stimuli (for testing)
 * @returns {{ manifest: object, stimuli: object[], errors: string[] }}
 */
export function generateAllStimuli(opts) {
  const {
    targetAudio,
    interferenceAudioPool = [],
    outputDir,
    sampleRate = MIXTURE_DEFAULTS.sampleRate,
    maxStimuli = Infinity,
  } = opts;

  // Check dependencies
  const deps = checkDependencies();
  if (!deps.ffmpeg || !deps.ffprobe) {
    throw new Error(`Missing dependencies: ffmpeg=${deps.ffmpeg}, ffprobe=${deps.ffprobe}`);
  }

  // Create output directories
  const stimuliDir = join(outputDir, "stimuli");
  const workDir = join(outputDir, "_work");
  mkdirSync(stimuliDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });

  // Normalize target audio
  const targetNormPath = join(workDir, "target_normalized.wav");
  console.log("Normalizing target audio...");
  const targetNormResult = loudnessNormalize(targetAudio, targetNormPath, MIXTURE_DEFAULTS.targetLUFS, sampleRate);
  if (!targetNormResult.ok) {
    throw new Error(`Target normalization failed: ${targetNormResult.stderr.slice(-200)}`);
  }

  const targetInfo = getAudioInfo(targetNormPath);
  if (!targetInfo) {
    throw new Error("Could not read target audio info");
  }

  // Generate factorial matrix
  const matrix = generateFactorialMatrix();
  console.log(`Factorial matrix: ${matrix.length} conditions`);

  const limitedMatrix = matrix.slice(0, maxStimuli);
  const stimuli = [];
  const errors = [];
  let completed = 0;

  for (const condition of limitedMatrix) {
    const outputPath = join(stimuliDir, `${condition.id}.wav`);
    const stimulusRecord = {
      ...condition,
      outputPath,
      targetDuration: targetInfo.duration,
      status: "pending",
    };

    try {
      if (condition.interferenceType === "silence" || condition.speakerCount === 1) {
        // Clean condition — just copy normalized target
        const copyResult = spawnSync("ffmpeg", [
          "-y", "-i", targetNormPath,
          "-c:a", "pcm_s16le",
          "-ar", String(sampleRate),
          "-ac", "1",
          outputPath,
        ], { encoding: "utf-8", timeout: 30000 });

        if (copyResult.status !== 0) {
          throw new Error(`Copy failed: ${copyResult.stderr?.slice(-200)}`);
        }
        stimulusRecord.status = "ok";
      } else {
        // Select interference speakers from pool
        const nInterference = condition.speakerCount - 1;
        const selectedInterference = [];

        for (let i = 0; i < nInterference; i++) {
          const poolIdx = i % interferenceAudioPool.length;
          const prepared = prepareInterference(
            interferenceAudioPool[poolIdx],
            condition.interferenceType,
            workDir,
            sampleRate,
          );
          if (prepared) selectedInterference.push(prepared);
        }

        if (selectedInterference.length === 0) {
          // No interference available — copy target
          spawnSync("ffmpeg", [
            "-y", "-i", targetNormPath,
            "-c:a", "pcm_s16le",
            "-ar", String(sampleRate),
            "-ac", "1",
            outputPath,
          ], { encoding: "utf-8", timeout: 30000 });
          stimulusRecord.status = "ok";
        } else if (selectedInterference.length === 1) {
          const mixResult = mixAudios(
            targetNormPath,
            selectedInterference[0],
            outputPath,
            condition.tirDb,
            condition.overlapFraction,
            sampleRate,
          );
          if (!mixResult.ok) {
            throw new Error(`Mix failed: ${mixResult.stderr.slice(-200)}`);
          }
          stimulusRecord.status = "ok";
        } else {
          const mixResult = mixMultiSpeaker(
            targetNormPath,
            selectedInterference,
            outputPath,
            condition.tirDb,
            condition.overlapFraction,
            sampleRate,
          );
          if (!mixResult.ok) {
            throw new Error(`Multi-speaker mix failed: ${mixResult.stderr.slice(-200)}`);
          }
          stimulusRecord.status = "ok";
        }
      }

      // Verify output
      const outInfo = getAudioInfo(outputPath);
      if (outInfo) {
        stimulusRecord.outputDuration = outInfo.duration;
        stimulusRecord.outputSampleRate = outInfo.sampleRate;
      }

      completed++;
      if (completed % 10 === 0) {
        console.log(`  ${completed}/${limitedMatrix.length} stimuli generated...`);
      }
    } catch (err) {
      stimulusRecord.status = "error";
      stimulusRecord.error = err.message;
      errors.push(`${condition.id}: ${err.message}`);
    }

    stimuli.push(stimulusRecord);
  }

  // Write manifest
  const manifest = {
    generatedAt: new Date().toISOString(),
    targetAudio: resolve(targetAudio),
    interferencePool: interferenceAudioPool.map(resolve),
    mixtureDefaults: MIXTURE_DEFAULTS,
    sampleRate,
    totalConditions: matrix.length,
    generatedConditions: stimuli.length,
    successful: stimuli.filter((s) => s.status === "ok").length,
    failed: stimuli.filter((s) => s.status === "error").length,
    stimuli,
  };

  const manifestPath = join(outputDir, "stimulus_manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Manifest written to ${manifestPath}`);
  console.log(`Generated: ${manifest.successful} ok, ${manifest.failed} failed`);

  return { manifest, stimuli, errors };
}

// ─── CLI entry point ─────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Usage: node src/generate_stimuli.js <target_audio> <interference_audio...> [--out <dir>] [--max <n>]");
    process.exit(1);
  }

  const targetAudio = args[0];
  const interferenceArgs = [];
  let outputDir = "./output";
  let maxStimuli = Infinity;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--out") {
      outputDir = args[++i];
    } else if (args[i] === "--max") {
      maxStimuli = parseInt(args[++i]);
    } else {
      interferenceArgs.push(args[i]);
    }
  }

  if (!existsSync(targetAudio)) {
    console.error(`Target audio not found: ${targetAudio}`);
    process.exit(1);
  }

  const result = generateAllStimuli({
    targetAudio,
    interferenceAudioPool: interferenceArgs,
    outputDir,
    maxStimuli,
  });

  if (result.errors.length > 0) {
    console.error(`\n${result.errors.length} errors:`);
    for (const err of result.errors) {
      console.error(`  ${err}`);
    }
  }

  process.exit(result.errors.length > 0 ? 1 : 0);
}

// Run CLI if invoked directly
if (process.argv[1] && resolve(process.argv[1]) === resolve(join(__dirname, "generate_stimuli.js"))) {
  try {
    main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
