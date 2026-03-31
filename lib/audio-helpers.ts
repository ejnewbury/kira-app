/**
 * Audio helpers for Kira app voice pipeline.
 * Lean utilities for recording, playback, and audio format conversion.
 */

import { Audio } from "expo-av";
import { Platform } from "react-native";

let audioInitialized = false;

/**
 * Initialize audio mode for recording + playback.
 * Call once at app start.
 */
export async function initAudioMode(): Promise<void> {
  if (audioInitialized || Platform.OS === "web") return;
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
    });
    audioInitialized = true;
  } catch (error) {
    console.warn("[Audio] Failed to init:", error);
  }
}

/**
 * Request microphone permission.
 */
export async function requestMicPermission(): Promise<boolean> {
  if (Platform.OS === "web") return true; // Browser handles via getUserMedia
  try {
    const { granted } = await Audio.requestPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}

/**
 * Convert base64 audio to Int16 PCM array.
 */
export function base64ToInt16Array(base64: string): Int16Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

/**
 * Convert Int16 PCM to Float32 (normalized to -1..1).
 */
export function int16ToFloat32(int16: Int16Array): Float32Array {
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

/**
 * Concatenate multiple Int16 arrays.
 */
export function concatenateInt16Arrays(arrays: Int16Array[]): Int16Array {
  let totalLength = 0;
  for (const arr of arrays) totalLength += arr.length;
  const result = new Int16Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Encode Int16 PCM data as WAV file (ArrayBuffer).
 */
export function encodeInt16ToWAV(
  samples: Int16Array,
  sampleRate: number = 16000,
  numChannels: number = 1,
): ArrayBuffer {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  // Write samples
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, samples[i], true);
  }

  return buffer;
}

/**
 * Convert ArrayBuffer to base64 string.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Simple audio playback from a URI.
 * Returns a cleanup function.
 */
export async function playAudioUri(
  uri: string,
  onDone?: () => void,
): Promise<() => void> {
  await initAudioMode();
  const { sound } = await Audio.Sound.createAsync(
    { uri },
    { shouldPlay: true },
  );

  sound.setOnPlaybackStatusUpdate((status) => {
    if (status.isLoaded && status.didJustFinish) {
      onDone?.();
      sound.unloadAsync().catch(() => {});
    }
  });

  return () => {
    sound.stopAsync().catch(() => {});
    sound.unloadAsync().catch(() => {});
  };
}

/**
 * Play audio from base64-encoded WAV data.
 */
export async function playAudioBase64(
  base64Wav: string,
  onDone?: () => void,
): Promise<() => void> {
  const uri = `data:audio/wav;base64,${base64Wav}`;
  return playAudioUri(uri, onDone);
}
