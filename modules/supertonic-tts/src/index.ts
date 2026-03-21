/**
 * react-native-supertonic-tts
 *
 * React Native bridge for Supertonic 2 TTS engine.
 * Wraps the Java SDK (Android) and Swift SDK (iOS) for on-device
 * multilingual text-to-speech via ONNX Runtime.
 *
 * Supports: EN, ES, FR, KO, PT
 * Model: 66M params, ~262MB ONNX files, non-autoregressive flow matching
 *
 * API designed to be a drop-in replacement for sherpa-onnx TTSManager.
 */

import { NativeModules, NativeEventEmitter, Platform } from "react-native";

const NativeSupertonicTTS = NativeModules.SupertonicTTS;

let emitter: NativeEventEmitter | null = null;
if (Platform.OS !== "web" && NativeSupertonicTTS) {
  emitter = new NativeEventEmitter(NativeSupertonicTTS);
}

export interface SupertonicTTSConfig {
  /** Path to directory containing ONNX models + tts.json + unicode_indexer.json */
  onnxDir: string;
  /** Path to voice style JSON file (e.g., M1.json, F1.json) */
  voiceStylePath: string;
  /** Number of denoising steps (2=fast, 5=balanced, 10=best quality) */
  totalStep?: number;
  /** Speech speed multiplier (>1 = faster, <1 = slower, default 1.05) */
  speed?: number;
}

/**
 * Initialize the Supertonic 2 TTS engine.
 *
 * Must be called before synthesize(). Loads 4 ONNX models (~262MB)
 * and the voice style embedding into memory.
 *
 * @param config - Paths to model files and synthesis parameters
 */
export function initialize(config: SupertonicTTSConfig): Promise<void> {
  if (!NativeSupertonicTTS) {
    return Promise.reject(new Error("SupertonicTTS native module not available"));
  }
  return NativeSupertonicTTS.initialize(
    config.onnxDir,
    config.voiceStylePath,
    config.totalStep ?? 2,
    config.speed ?? 1.05
  );
}

/**
 * Synthesize text to speech and play through device speaker.
 *
 * @param text - Text to speak
 * @param language - Language code: "en", "es", "fr", "ko", "pt"
 */
export function generateAndPlay(text: string, language: string): Promise<void> {
  if (!NativeSupertonicTTS) {
    return Promise.reject(new Error("SupertonicTTS native module not available"));
  }
  return NativeSupertonicTTS.generateAndPlay(text, language);
}

/**
 * Synthesize text to a WAV file.
 *
 * @param text - Text to speak
 * @param language - Language code
 * @returns Path to the generated WAV file
 */
export function generateToFile(
  text: string,
  language: string
): Promise<string> {
  if (!NativeSupertonicTTS) {
    return Promise.reject(new Error("SupertonicTTS native module not available"));
  }
  return NativeSupertonicTTS.generateToFile(text, language);
}

/**
 * Stop any currently playing audio.
 */
export function stop(): void {
  NativeSupertonicTTS?.stop();
}

/**
 * Free all native resources (ONNX sessions, audio player).
 * Must be called when done with TTS.
 */
export function deinitialize(): void {
  try {
    NativeSupertonicTTS?.deinitialize();
  } catch {
    // Non-fatal — may fail if bridge already torn down
  }
}

/**
 * Check if the native module is available.
 */
export function isAvailable(): boolean {
  return Platform.OS !== "web" && NativeSupertonicTTS != null;
}

/**
 * Get the sample rate of the loaded model.
 */
export function getSampleRate(): Promise<number> {
  if (!NativeSupertonicTTS) {
    return Promise.reject(new Error("SupertonicTTS native module not available"));
  }
  return NativeSupertonicTTS.getSampleRate();
}

/**
 * Listen for playback progress events.
 * Callback receives { progress: number } where 0-1 is playback position.
 */
export function addPlaybackListener(
  callback: (event: { progress: number }) => void
) {
  if (!emitter) return { remove: () => {} };
  return emitter.addListener("SupertonicTTSProgress", callback);
}

/**
 * Listen for playback completion events.
 */
export function addCompletionListener(callback: () => void) {
  if (!emitter) return { remove: () => {} };
  return emitter.addListener("SupertonicTTSComplete", callback);
}

// Re-export for backward compatibility with sherpa-onnx TTSManager API shape
export default {
  initialize: (configJson: string) => {
    // Parse the config JSON that offline-tts-service.ts sends
    const config = JSON.parse(configJson) as {
      onnxDir: string;
      voiceStylePath: string;
      totalStep?: number;
      speed?: number;
    };
    return initialize(config);
  },
  generateAndPlay: (text: string, language: string, _speed?: number) =>
    generateAndPlay(text, language),
  generateAndSave: (text: string, language: string) =>
    generateToFile(text, language),
  deinitialize,
  stop,
  isAvailable,
};
