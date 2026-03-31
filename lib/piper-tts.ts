/**
 * Kira TTS Service — Cloud voice synthesis via Voxtral (Mistral AI).
 *
 * Uses Voxtral's zero-shot voice cloning with a 15s Kira reference clip.
 * Falls back to ElevenLabs if Voxtral fails, then expo-speech as last resort.
 *
 * Future: On-device Piper TTS via custom native module
 * (blocked by sherpa-onnx libc++_shared.so conflict with Samsung hwui).
 */

import { Audio } from "expo-av";

let Speech: any = null;
let FileSystem: any = null;
let Asset: any = null;

try { Speech = require("expo-speech"); } catch {}
try { FileSystem = require("expo-file-system/legacy"); } catch {
  try { FileSystem = require("expo-file-system"); } catch {}
}
try { Asset = require("expo-asset").Asset; } catch {}

export type TTSEngine = "voxtral" | "elevenlabs" | "system" | "none";

// Voxtral (primary — $16/1M chars)
const MISTRAL_API_KEY = "SYEDhXJ7VQk34cvmM6zZCn4jPQBKxQi1";
const VOXTRAL_TTS_URL = "https://api.mistral.ai/v1/audio/speech";

// ElevenLabs (fallback — $5/1M chars in-quota, $300/1M overage)
const ELEVENLABS_API_KEY = "sk_ccdf5bc25b5ed14acb1014f8033633ddc37aaaf3bf87b893";
const KIRA_VOICE_ID = "W9Ar7fndeXRhsFHnuhIG";
const ELEVENLABS_TTS_URL = `https://api.elevenlabs.io/v1/text-to-speech/${KIRA_VOICE_ID}`;

// Cached reference audio for Voxtral voice cloning
let refAudioBase64: string | null = null;

interface TTSState {
  isInitialized: boolean;
  isSpeaking: boolean;
  currentSound: Audio.Sound | null;
}

const state: TTSState = {
  isInitialized: false,
  isSpeaking: false,
  currentSound: null,
};

async function loadRefAudio(): Promise<void> {
  if (refAudioBase64) return;
  try {
    // Load bundled reference clip
    if (Asset && FileSystem) {
      const [asset] = await Asset.loadAsync(require("../assets/kira-ref-15s.wav"));
      if (asset.localUri) {
        const b64 = await FileSystem.readAsStringAsync(asset.localUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        refAudioBase64 = b64;
        console.log("[KiraTTS] Loaded Kira reference clip for Voxtral");
        return;
      }
    }
  } catch (e: any) {
    console.warn("[KiraTTS] Failed to load ref audio:", e.message);
  }
}

export async function initializePiperTTS(): Promise<boolean> {
  if (MISTRAL_API_KEY && FileSystem) {
    await loadRefAudio();
    state.isInitialized = true;
    console.log("[KiraTTS] Voxtral cloud TTS ready (ElevenLabs fallback)");
    return true;
  }
  if (ELEVENLABS_API_KEY && FileSystem) {
    state.isInitialized = true;
    console.log("[KiraTTS] ElevenLabs cloud TTS ready (no Voxtral)");
    return true;
  }
  return false;
}

export async function speak(text: string): Promise<void> {
  if (!text?.trim()) return;

  if (!state.isInitialized) {
    await initializePiperTTS();
  }

  if (state.isInitialized && refAudioBase64) {
    return speakWithVoxtral(text);
  }

  if (state.isInitialized) {
    return speakWithElevenLabs(text);
  }

  return speakWithSystem(text);
}

async function speakWithVoxtral(text: string): Promise<void> {
  if (state.isSpeaking) await stop();
  state.isSpeaking = true;

  try {
    const res = await fetch(VOXTRAL_TTS_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MISTRAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "voxtral-mini-tts-2603",
        input: text.slice(0, 5000),
        ref_audio: refAudioBase64,
        response_format: "wav",
      }),
    });

    if (!res.ok) {
      console.warn("[KiraTTS] Voxtral error:", res.status, "— falling back to ElevenLabs");
      state.isSpeaking = false;
      return speakWithElevenLabs(text);
    }

    const data = await res.json();
    if (!data.audio_data) {
      console.warn("[KiraTTS] Voxtral: no audio_data in response");
      state.isSpeaking = false;
      return speakWithElevenLabs(text);
    }

    const tempPath = `${FileSystem.cacheDirectory}kira-tts-output.wav`;
    await FileSystem.writeAsStringAsync(tempPath, data.audio_data, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const { sound } = await Audio.Sound.createAsync(
      { uri: tempPath },
      { shouldPlay: true }
    );

    state.currentSound = sound;

    return new Promise<void>((resolve) => {
      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.didJustFinish) {
          state.isSpeaking = false;
          state.currentSound = null;
          sound.unloadAsync().catch(() => {});
          resolve();
        }
      });
    });
  } catch (e: any) {
    console.error("[KiraTTS] Voxtral failed:", e.message || e);
    state.isSpeaking = false;
    return speakWithElevenLabs(text);
  }
}

async function speakWithElevenLabs(text: string): Promise<void> {
  if (state.isSpeaking) await stop();
  state.isSpeaking = true;

  try {
    const res = await fetch(ELEVENLABS_TTS_URL, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text: text.slice(0, 5000), // ElevenLabs limit
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.3,
        },
      }),
    });

    if (!res.ok) {
      console.warn("[KiraTTS] ElevenLabs error:", res.status);
      state.isSpeaking = false;
      return speakWithSystem(text);
    }

    const audioData = await res.arrayBuffer();
    const bytes = new Uint8Array(audioData);
    let base64 = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      base64 += String.fromCharCode(...bytes.slice(i, i + 8192));
    }
    base64 = btoa(base64);

    const tempPath = `${FileSystem.cacheDirectory}kira-tts-output.mp3`;
    await FileSystem.writeAsStringAsync(tempPath, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const { sound } = await Audio.Sound.createAsync(
      { uri: tempPath },
      { shouldPlay: true }
    );

    state.currentSound = sound;

    return new Promise<void>((resolve) => {
      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.didJustFinish) {
          state.isSpeaking = false;
          state.currentSound = null;
          sound.unloadAsync().catch(() => {});
          resolve();
        }
      });
    });
  } catch (e: any) {
    console.error("[KiraTTS] Speak failed:", e.message || e);
    state.isSpeaking = false;
    return speakWithSystem(text);
  }
}

function speakWithSystem(text: string): Promise<void> {
  if (!Speech) return Promise.resolve();
  state.isSpeaking = true;
  return new Promise<void>((resolve) => {
    Speech.speak(text, {
      language: "en-US",
      rate: 1.0,
      pitch: 1.0,
      onDone: () => { state.isSpeaking = false; resolve(); },
      onError: () => { state.isSpeaking = false; resolve(); },
    });
  });
}

export async function stop(): Promise<void> {
  state.isSpeaking = false;
  if (state.currentSound) {
    try { await state.currentSound.stopAsync(); await state.currentSound.unloadAsync(); } catch {}
    state.currentSound = null;
  }
  if (Speech) { try { Speech.stop(); } catch {} }
}

export async function destroy(): Promise<void> {
  await stop();
  state.isInitialized = false;
}

export function getActiveEngine(): TTSEngine {
  if (state.isInitialized && refAudioBase64) return "voxtral";
  if (state.isInitialized) return "elevenlabs";
  if (Speech) return "system";
  return "none";
}

export function isSpeaking(): boolean {
  return state.isSpeaking;
}
