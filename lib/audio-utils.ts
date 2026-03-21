// Shared audio utilities to avoid circular dependencies
// Moved from speech.ts to break circular import with tts-service.ts

import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import log from "@/lib/logger";
import { forceReleaseTTS, pauseActiveRecorder } from "./tts-state";

// Current sound instance for stopping playback
let currentSound: Audio.Sound | null = null;
export { currentSound };

let isCurrentlyPlaying = false;
export { isCurrentlyPlaying };

// For web: HTML5 Audio element or SpeechSynthesis utterance
let webAudio: HTMLAudioElement | null = null;
export { webAudio };

let webUtterance: SpeechSynthesisUtterance | null = null;
export { webUtterance };

// Current native audio element
let currentNativeAudio: HTMLAudioElement | null = null;
export { currentNativeAudio };

// OpenAI TTS voices for different genders
const MALE_VOICES = ["echo", "onyx"]; // echo and onyx are male voices
const FEMALE_VOICES = ["nova", "shimmer"]; // nova and shimmer are female voices
const DEFAULT_VOICE = "nova"; // fallback voice
export { MALE_VOICES, FEMALE_VOICES, DEFAULT_VOICE };

// OpenAI TTS API endpoint
const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
// CORS proxy for web development - same one used for chat completions
const CORS_PROXY = "https://corsproxy.io/?";
export { OPENAI_TTS_URL, CORS_PROXY };

// More reliable browser detection (Platform.OS can be unreliable in some bundling scenarios)
function isBrowser(): boolean {
  return Platform.OS === "web" || (typeof window !== "undefined" && typeof document !== "undefined");
}
export { isBrowser };

// Import audioService for native audio
import { audioService } from "./audio-service";
export { audioService };

/**
 * Play audio on web using HTML5 Audio
 */
export async function playOnWeb(
  audioBlob: Blob,
  onDone?: () => void,
  onError?: (error: Error) => void
): Promise<void> {
  // Stop any currently playing audio first
  await stopSpeaking();
  log.debug("Audio", "Playing on web, blob size:", audioBlob.size, "type:", audioBlob.type);

  // Create blob URL
  const audioUrl = URL.createObjectURL(audioBlob);
  log.debug("Audio", "Created blob URL:", audioUrl);

  // Create HTML5 audio element
  webAudio = new window.Audio();

  // Set up event handlers before setting src
  webAudio.oncanplaythrough = () => {
    log.debug("Audio", "Web audio can play through");
  };

  webAudio.onloadeddata = () => {
    log.debug("Audio", "Web audio loaded data");
  };

  webAudio.onended = () => {
    log.debug("Audio", "Web playback ended");
    isCurrentlyPlaying = false;
    URL.revokeObjectURL(audioUrl);
    webAudio = null;
    onDone?.();
  };

  webAudio.onerror = (e) => {
    const error = webAudio?.error;
    log.warn("Audio", "Web audio error:", e, "code:", error?.code, "message:", error?.message);
    isCurrentlyPlaying = false;
    URL.revokeObjectURL(audioUrl);
    webAudio = null;
    onError?.(new Error(`Web audio playback failed: ${error?.message || "unknown"}`));
  };

  // Set source
  webAudio.src = audioUrl;
  webAudio.load();
  isCurrentlyPlaying = true;

  try {
    log.debug("Audio", "Attempting to play web audio...");
    const playPromise = webAudio.play();
    if (playPromise !== undefined) {
      await playPromise;
      log.debug("Audio", "Web audio playing successfully");
    }
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    log.warn("Audio", "Web play() error:", errorMessage);
    isCurrentlyPlaying = false;
    URL.revokeObjectURL(audioUrl);
    webAudio = null;

    // Provide helpful message for autoplay issues
    if (errorMessage.includes("interact") || errorMessage.includes("autoplay") || errorMessage.includes("user gesture")) {
      log.warn("Audio", "Browser blocked autoplay - user interaction required");
    }
    onError?.(e as Error);
  }
}

/**
 * Play audio on native using expo-av
 */
export async function playOnNative(
  audioBlob: Blob,
  onDone?: () => void,
  onError?: (error: Error) => void
): Promise<void> {
  // Stop any currently playing audio first
  await stopSpeaking();
  // Pause any active recorder — Android can't play while recording holds audio focus
  await pauseActiveRecorder();
  log.debug("Audio", "Playing on native...");

  // Convert blob to base64
  const reader = new FileReader();

  await new Promise<void>((resolve, reject) => {
    reader.onloadend = async () => {
      try {
        const base64Data = (reader.result as string).split(",")[1];

        // Save to temp file (expo-av needs a URI)
        const fileUri = `${FileSystem.cacheDirectory}tts_${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(fileUri, base64Data, {
          encoding: FileSystem.EncodingType.Base64,
        });

        log.debug("Audio", "Saved to:", fileUri);

        // Configure audio mode
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
        });

        // Create and play sound
        const { sound } = await Audio.Sound.createAsync(
          { uri: fileUri },
          { shouldPlay: true }
        );

        currentSound = sound;
        isCurrentlyPlaying = true;
        log.debug("Audio", "Native audio playing");

        // Handle playback completion
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            log.debug("Audio", "Native playback ended");
            isCurrentlyPlaying = false;
            currentSound = null;
            sound.unloadAsync();
            // Clean up temp file
            FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
            onDone?.();
          }
        });

        resolve();
      } catch (err) {
        log.error("Audio", "Native processing error:", err);
        reject(err);
      }
    };
    reader.onerror = () => {
      log.error("Audio", "FileReader error:", reader.error);
      reject(reader.error);
    };
    reader.readAsDataURL(audioBlob);
  });
}

/**
 * Play base64-encoded audio directly on native (no Blob needed).
 * Writes base64 to a temp file and plays via expo-av.
 */
export async function playBase64OnNative(
  base64Audio: string,
  onDone?: () => void,
  onError?: (error: Error) => void
): Promise<void> {
  await stopSpeaking();
  // Pause any active recorder — Android can't play while recording holds audio focus
  await pauseActiveRecorder();
  log.debug("Audio", "Playing base64 on native...");

  try {
    const fileUri = `${FileSystem.cacheDirectory}tts_${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(fileUri, base64Audio, {
      encoding: FileSystem.EncodingType.Base64,
    });

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });

    const { sound } = await Audio.Sound.createAsync(
      { uri: fileUri },
      { shouldPlay: true }
    );

    currentSound = sound;
    isCurrentlyPlaying = true;
    log.debug("Audio", "Native base64 audio playing");

    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        log.debug("Audio", "Native base64 playback ended");
        isCurrentlyPlaying = false;
        currentSound = null;
        sound.unloadAsync();
        FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
        onDone?.();
      }
    });
  } catch (err) {
    log.error("Audio", "Native base64 playback error:", err);
    onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Play using browser's Web Speech API (works without API calls)
 */
export function playWithWebSpeechAPI(
  text: string,
  rate: number,
  onDone?: () => void,
  onError?: (error: Error) => void,
  languageCode?: string
): void {
  log.warn("Audio", "⚠️  FALLING BACK TO WEB SPEECH API - LOW QUALITY AUDIO ⚠️");
  log.warn("Audio", "This will sound robotic/digital. Native audio preferred.");

  if (typeof window === "undefined" || !window.speechSynthesis) {
    log.warn("Audio", "Web Speech API not available");
    onError?.(new Error("Speech synthesis not available in this browser"));
    return;
  }

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  // Function to speak once voices are ready
  const speakWithVoices = () => {
    // Truncate long text - Web Speech can fail on very long strings
    const maxLength = 500;
    const truncatedText = text.length > maxLength
      ? text.substring(0, maxLength) + "..."
      : text;

    webUtterance = new SpeechSynthesisUtterance(truncatedText);

    // Map language code to BCP-47 locale for Web Speech API
    const langMap: Record<string, string> = {
      es: "es-ES",
      fr: "fr-FR",
      ko: "ko-KR",
    };
    const lang = languageCode || "es";
    webUtterance.lang = langMap[lang] || `${lang}-${lang.toUpperCase()}`;
    webUtterance.rate = rate;
    webUtterance.pitch = 1.0;
    webUtterance.volume = 1.0;

    // Try to find a voice matching the target language
    const voices = window.speechSynthesis.getVoices();
    log.debug("Audio", "Available voices:", voices.length);

    const matchedVoice = voices.find(v => v.lang.startsWith(lang) && v.name.toLowerCase().includes("female"))
      || voices.find(v => v.lang.startsWith(lang))
      || voices.find(v => v.lang.startsWith("en")) // Fallback to English
      || voices[0];

    if (matchedVoice) {
      webUtterance.voice = matchedVoice;
      log.debug("Audio", "Using voice:", matchedVoice.name, "lang:", matchedVoice.lang);
    } else {
      log.debug("Audio", "No voice found, using default");
    }

    webUtterance.onstart = () => {
      log.debug("Audio", "Web Speech started");
      isCurrentlyPlaying = true;
    };

    webUtterance.onend = () => {
      log.debug("Audio", "Web Speech ended");
      isCurrentlyPlaying = false;
      webUtterance = null;
      onDone?.();
    };

    webUtterance.onerror = (e) => {
      log.warn("Audio", "Web Speech error:", e.error);
      isCurrentlyPlaying = false;
      webUtterance = null;
      // Don't report "interrupted" as an error (happens when stopping)
      if (e.error !== "interrupted") {
        onError?.(new Error(`Speech error: ${e.error}`));
      }
    };

    // Chrome has a bug where speech synthesis can hang - use this workaround
    // https://bugs.chromium.org/p/chromium/issues/detail?id=679437
    const resumeInfinity = () => {
      if (isCurrentlyPlaying) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
        setTimeout(resumeInfinity, 10000);
      }
    };

    window.speechSynthesis.speak(webUtterance);

    // Start the Chrome workaround after a short delay
    setTimeout(resumeInfinity, 10000);
  };

  // Voices may not be loaded yet - wait for them
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    speakWithVoices();
  } else {
    log.debug("Audio", "Waiting for voices to load...");
    // Voices load asynchronously in Chrome
    window.speechSynthesis.onvoiceschanged = () => {
      log.debug("Audio", "Voices loaded, speaking now");
      speakWithVoices();
    };
    // Fallback: try speaking anyway after a short delay
    setTimeout(() => {
      if (!isCurrentlyPlaying) {
        log.debug("Audio", "Fallback: speaking without waiting for voices");
        speakWithVoices();
      }
    }, 500);
  }
}

/**
 * Play native speaker audio
 */
export async function playNativeAudio(
  audioElement: HTMLAudioElement,
  options: { onDone?: () => void; onError?: (error: Error) => void } = {}
): Promise<void> {
  const { onDone, onError } = options;

  return new Promise((resolve, reject) => {
    // Stop any current playback
    stopSpeaking();

    currentNativeAudio = audioElement;
    isCurrentlyPlaying = true;

    audioElement.currentTime = 0;

    const handleEnded = () => {
      cleanup();
      onDone?.();
      resolve();
    };

    const handleError = (error: Event) => {
      cleanup();
      const err = new Error("Native audio playback failed");
      onError?.(err);
      reject(err);
    };

    const cleanup = () => {
      if (currentNativeAudio) {
        currentNativeAudio.removeEventListener('ended', handleEnded);
        currentNativeAudio.removeEventListener('error', handleError);
        currentNativeAudio = null;
      }
      isCurrentlyPlaying = false;
    };

    audioElement.addEventListener('ended', handleEnded);
    audioElement.addEventListener('error', handleError);

    audioElement.play().catch((error) => {
      cleanup();
      const err = new Error(`Audio play failed: ${error.message}`);
      onError?.(err);
      reject(err);
    });
  });
}

/**
 * Stop any ongoing speech/audio
 */
export async function stopSpeaking(): Promise<void> {
  // Release any TTS lock so new audio can claim it
  forceReleaseTTS();

  // Stop Web Speech API
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  webUtterance = null;

  // Stop web audio
  if (webAudio) {
    webAudio.pause();
    webAudio.currentTime = 0;
    webAudio = null;
  }

  // Stop native speaker audio
  if (currentNativeAudio) {
    currentNativeAudio.pause();
    currentNativeAudio.currentTime = 0;
    currentNativeAudio = null;
  }

  // Stop native audio
  if (currentSound) {
    try {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
    } catch (e) {
      // Ignore errors when stopping
    }
    currentSound = null;
  }

  isCurrentlyPlaying = false;
}

/**
 * Check if currently speaking
 */
export function isSpeaking(): boolean {
  return isCurrentlyPlaying;
}

// ─── TTS Audio Cache ────────────────────────────────────────────────
// Caches generated TTS audio on native so repeat words play instantly.
// Files persist in the app cache directory across sessions.

const TTS_CACHE_DIR = `${FileSystem.cacheDirectory}tts_cache/`;
const ttsCacheIndex = new Map<string, string>(); // cacheKey → fileUri
let ttsCacheDirReady = false;

/** Deterministic hash for cache filenames from text+voice */
function ttsCacheKey(text: string, voice: string): string {
  let hash = 0;
  const input = `${voice}:${text}`;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return `tts_${Math.abs(hash).toString(36)}`;
}

async function ensureTTSCacheDir(): Promise<void> {
  if (ttsCacheDirReady) return;
  const info = await FileSystem.getInfoAsync(TTS_CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(TTS_CACHE_DIR, { intermediates: true });
  }
  ttsCacheDirReady = true;
}

/** Check if TTS audio is cached for this text+voice. Returns file URI or null. */
export async function getCachedTTSUri(text: string, voice: string): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const key = ttsCacheKey(text, voice);

  // In-memory fast path
  if (ttsCacheIndex.has(key)) return ttsCacheIndex.get(key)!;

  // Filesystem check
  const fileUri = `${TTS_CACHE_DIR}${key}.mp3`;
  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    if (info.exists) {
      ttsCacheIndex.set(key, fileUri);
      return fileUri;
    }
  } catch { /* not cached */ }
  return null;
}

/** Save base64-encoded audio to the cache. Returns the file URI. */
export async function saveTTSToCache(text: string, voice: string, base64Audio: string): Promise<string> {
  await ensureTTSCacheDir();
  const key = ttsCacheKey(text, voice);
  const fileUri = `${TTS_CACHE_DIR}${key}.mp3`;
  await FileSystem.writeAsStringAsync(fileUri, base64Audio, {
    encoding: FileSystem.EncodingType.Base64,
  });
  ttsCacheIndex.set(key, fileUri);
  return fileUri;
}

/**
 * Encode Int16 PCM samples into a WAV ArrayBuffer.
 * Used by native Silero VAD to produce a file the transcription pipeline can consume.
 */
export function encodeInt16ToWAV(samples: Int16Array, sampleRate: number = 16000): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);          // Sub-chunk size (PCM = 16)
  view.setUint16(20, 1, true);           // Audio format (PCM = 1)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Write PCM samples
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, samples[i], true);
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// ─── Base64 / PCM Conversion Utilities ─────────────────────────────
// Used by the native Silero VAD pipeline (expo-audio-studio → model → WAV file)

/**
 * Decode a base64-encoded PCM 16-bit buffer into Int16Array.
 * expo-audio-studio's onAudioStream sends audio data as base64.
 */
export function base64ToInt16Array(base64: string): Int16Array {
  // atob is available in both browsers and Hermes (RN 0.81+)
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

/**
 * Encode an ArrayBuffer to base64 string.
 * Used to write WAV data to a file via expo-file-system.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  // btoa is available in both browsers and Hermes (RN 0.81+)
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Normalize Int16 PCM samples to Float32 in range [-1.0, 1.0].
 * Silero VAD expects normalized float input.
 */
export function int16ToFloat32(int16: Int16Array): Float32Array {
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }
  return float32;
}

/**
 * Concatenate multiple Int16Array chunks into a single Int16Array.
 * Used to combine buffered audio chunks after speech ends.
 */
export function concatenateInt16Arrays(arrays: Int16Array[]): Int16Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Int16Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/** Play audio directly from a cached file URI using expo-av. */
export async function playCachedAudio(
  fileUri: string,
  onDone?: () => void,
  onError?: (error: Error) => void
): Promise<void> {
  await stopSpeaking();
  await pauseActiveRecorder();
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });
    const { sound } = await Audio.Sound.createAsync(
      { uri: fileUri },
      { shouldPlay: true }
    );
    currentSound = sound;
    isCurrentlyPlaying = true;
    log.debug("Audio", "Playing cached audio");

    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        log.debug("Audio", "Cached playback ended");
        isCurrentlyPlaying = false;
        currentSound = null;
        sound.unloadAsync();
        onDone?.();
      }
    });
  } catch (err) {
    log.error("Audio", "Cached playback error:", err);
    onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}
