/**
 * Tests for the audio mixer module.
 * Run with: node tests/test_mixer.js
 */
import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MIXTURE_DEFAULTS,
  tirToGain,
  overlapStartTime,
  checkDependencies,
  loudnessNormalize,
  mixAudios,
} from "../src/mix_audios_dynamic.js";

// Check if ffmpeg is available
const deps = checkDependencies();
const hasFfmpeg = deps.ffmpeg && deps.ffprobe;

test("MIXTURE_DEFAULTS should be frozen and correct", () => {
  assert.strictEqual(MIXTURE_DEFAULTS.normalize, 0);
  assert.strictEqual(MIXTURE_DEFAULTS.targetLUFS, -23.0);
  assert.strictEqual(MIXTURE_DEFAULTS.sampleRate, 48000);
  assert.strictEqual(MIXTURE_DEFAULTS.channelLayout, "mono");
  assert.ok(Object.isFrozen(MIXTURE_DEFAULTS));
});

test("tirToGain should convert dB to linear gain correctly", () => {
  // 0 dB → gain 1.0
  assert.ok(Math.abs(tirToGain(0) - 1.0) < 1e-6);
  // +20 dB → gain 0.1 (interference is 10% of target)
  assert.ok(Math.abs(tirToGain(20) - 0.1) < 1e-6);
  // -3 dB → gain ~1.41
  assert.ok(Math.abs(tirToGain(-3) - 1.4125) < 0.01);
});

test("overlapStartTime should compute correct offset", () => {
  assert.strictEqual(overlapStartTime(10, 0.0), 10);
  assert.strictEqual(overlapStartTime(10, 0.25), 7.5);
  assert.strictEqual(overlapStartTime(10, 0.50), 5);
  assert.strictEqual(overlapStartTime(10, 0.75), 2.5);
  assert.strictEqual(overlapStartTime(10, 1.0), 0);
});

test("overlapStartTime should reject invalid fractions", () => {
  assert.throws(() => overlapStartTime(10, -0.1), RangeError);
  assert.throws(() => overlapStartTime(10, 1.1), RangeError);
});

test("checkDependencies should return boolean values", () => {
  assert.strictEqual(typeof deps.ffmpeg, "boolean");
  assert.strictEqual(typeof deps.ffprobe, "boolean");
});

// Generate a test tone if ffmpeg is available
function generateTestTone(filePath, durationSec = 2, freq = 440) {
  const args = [
    "-y",
    "-f", "lavfi",
    "-i", `sine=frequency=${freq}:duration=${durationSec}:sample_rate=48000`,
    "-ac", "1",
    "-c:a", "pcm_s16le",
    filePath,
  ];
  const result = spawnSync("ffmpeg", args, { encoding: "utf-8", timeout: 10000 });
  return result.status === 0;
}

if (hasFfmpeg) {
  test("loudnessNormalize should produce a valid audio file", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "asr-test-"));
    try {
      const inputPath = join(tmpDir, "tone.wav");
      const outputPath = join(tmpDir, "tone_norm.wav");

      assert.ok(generateTestTone(inputPath), "Test tone generation failed");

      const result = loudnessNormalize(inputPath, outputPath);
      assert.ok(result.ok, `Normalization failed: ${result.stderr?.slice(-200)}`);
      assert.ok(existsSync(outputPath), "Output file should exist");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("mixAudios should mix two audio files at specified TIR", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "asr-test-"));
    try {
      const targetPath = join(tmpDir, "target.wav");
      const interferencePath = join(tmpDir, "interference.wav");
      const mixedPath = join(tmpDir, "mixed.wav");

      assert.ok(generateTestTone(targetPath, 3, 440));
      assert.ok(generateTestTone(interferencePath, 3, 880));

      const normTarget = join(tmpDir, "target_norm.wav");
      const normInterference = join(tmpDir, "interference_norm.wav");
      assert.ok(loudnessNormalize(targetPath, normTarget).ok);
      assert.ok(loudnessNormalize(interferencePath, normInterference).ok);

      const result = mixAudios(normTarget, normInterference, mixedPath, 6, 0.5);
      assert.ok(result.ok, `Mix failed: ${result.stderr?.slice(-200)}`);
      assert.ok(existsSync(mixedPath), "Mixed file should exist");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
} else {
  console.log("Skipping ffmpeg-dependent tests (ffmpeg not available)");
}
