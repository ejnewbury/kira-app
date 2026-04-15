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

export type TTSEngine = "mithra" | "voxtral" | "elevenlabs" | "system" | "none";

// Mithra (home Qwen3-TTS 1.7B Kira fine-tune — exposed via Cloudflare Tunnel)
// No timeouts, no skip-windows: fallback only on real failure (HTTP 4xx/5xx, fetch errors, malformed audio).
const MITHRA_TTS_URL = "https://item-positive-lake-marie.trycloudflare.com/tts";
const MITHRA_API_KEY = "1e393a1a659a61e45f92381f55c41cec439affa1b999bd1378441d0d242db839";

// Fire-and-forget telemetry POST so we can trace which branch of the TTS chain fired.
// Server side: /api/kira/tts-log writes to Supabase. Failures are swallowed.
async function logTTS(event: string, extra: Record<string, any> = {}): Promise<void> {
  try {
    await fetch("https://kira-backend-six.vercel.app/api/kira/tts-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, ts: Date.now(), ...extra }),
    });
  } catch {}
}

// Voxtral (fallback — $16/1M chars)
const MISTRAL_API_KEY = "SYEDhXJ7VQk34cvmM6zZCn4jPQBKxQi1";
const VOXTRAL_TTS_URL = "https://api.mistral.ai/v1/audio/speech";

// ElevenLabs (fallback — $5/1M chars in-quota, $300/1M overage)
const ELEVENLABS_API_KEY = "sk_ccdf5bc25b5ed14acb1014f8033633ddc37aaaf3bf87b893";
const KIRA_VOICE_ID = "W9Ar7fndeXRhsFHnuhIG";
const ELEVENLABS_TTS_URL = `https://api.elevenlabs.io/v1/text-to-speech/${KIRA_VOICE_ID}`;

// Cached reference audio for Voxtral voice cloning — per-speaker
let refAudioBase64: string | null = null;       // Kira's voice
let qwenRefAudioBase64: string | null = null;   // QwenBoy's JARVIS voice
let riffRefAudioBase64: string | null = null;   // RiffBot's Bill Corbett voice
let currentSpeaker: "kira" | "qwenboy" | "riffbot" = "kira";

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
  try {
    if (!Asset || !FileSystem) return;

    // Load Kira's voice
    if (!refAudioBase64) {
      const [kiraAsset] = await Asset.loadAsync(require("../assets/kira-ref-15s.wav"));
      if (kiraAsset.localUri) {
        refAudioBase64 = await FileSystem.readAsStringAsync(kiraAsset.localUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        console.log("[KiraTTS] Loaded Kira reference clip");
      }
    }

    // Load QwenBoy's JARVIS voice
    if (!qwenRefAudioBase64) {
      const [qwenAsset] = await Asset.loadAsync(require("../assets/qwenboy-ref.wav"));
      if (qwenAsset.localUri) {
        qwenRefAudioBase64 = await FileSystem.readAsStringAsync(qwenAsset.localUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        console.log("[KiraTTS] Loaded QwenBoy JARVIS reference clip");
      }
    }

    // Load RiffBot's Bill Corbett voice
    if (!riffRefAudioBase64) {
      const [riffAsset] = await Asset.loadAsync(require("../assets/riffbot-ref.wav"));
      if (riffAsset.localUri) {
        riffRefAudioBase64 = await FileSystem.readAsStringAsync(riffAsset.localUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        console.log("[KiraTTS] Loaded RiffBot reference clip");
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

export async function speak(text: string, speaker: "kira" | "qwenboy" | "riffbot" = "kira"): Promise<void> {
  if (!text?.trim()) return;
  currentSpeaker = speaker;
  logTTS("speak.enter", { speaker, chars: text.length });

  if (!state.isInitialized) {
    await initializePiperTTS();
  }

  // Try Mithra first for Kira's own voice only (QwenBoy / RiffBot still route through Voxtral).
  // No separate /health probe — a successful /tts IS the probe. Cuts the round-trip.
  if (speaker === "kira") {
    const ok = await speakWithMithra(text);
    if (ok) return;
    logTTS("mithra.fallthrough", { next: "voxtral" });
  }

  const ref = speaker === "qwenboy" ? qwenRefAudioBase64 : speaker === "riffbot" ? riffRefAudioBase64 : refAudioBase64;
  if (state.isInitialized && ref) {
    logTTS("voxtral.attempt", { speaker });
    return speakWithVoxtral(text);
  }

  if (state.isInitialized) {
    logTTS("elevenlabs.attempt", { speaker });
    return speakWithElevenLabs(text);
  }

  logTTS("system.fallback", { speaker });
  return speakWithSystem(text);
}

// Split text into sentence-sized chunks so we can pipeline synth + playback.
// Regex grabs runs ending in .?! (keeping the punctuation) OR a final trailing fragment.
// Tiny chunks (<12 chars) merge into the previous chunk, or if there's no previous,
// into the next — so "v1.10 is shipping." doesn't split at "v1." + "10 is shipping."
// and "One? Two! Three." doesn't become three micro-fragments.
function splitSentences(text: string): string[] {
  const raw = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const trimmed = raw.map(s => s.trim()).filter(s => s.length > 0);
  const cleaned: string[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    const t = trimmed[i];
    if (t.length < 12) {
      if (cleaned.length > 0) {
        cleaned[cleaned.length - 1] += " " + t;
      } else if (i + 1 < trimmed.length) {
        trimmed[i + 1] = t + " " + trimmed[i + 1];
      } else {
        cleaned.push(t);
      }
    } else {
      cleaned.push(t);
    }
  }
  return cleaned.length > 0 ? cleaned : [text];
}

// Hang-detector (not a premature-fallback timeout): real synth is ~5s; 45s means the
// connection is genuinely dead. Without this, a single stalled fetch blocks the whole
// pipeline forever since there's no progress-based detection in RN fetch.
const MITHRA_HANG_DETECT_MS = 45000;

async function synthMithraFragment(text: string): Promise<ArrayBuffer | null> {
  const ctrl = new AbortController();
  const hangTimer = setTimeout(() => ctrl.abort(), MITHRA_HANG_DETECT_MS);
  try {
    const res = await fetch(MITHRA_TTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Kira-Api-Key": MITHRA_API_KEY,
      },
      body: JSON.stringify({
        text: text.slice(0, 2000),
        language: "english",
        speaker: "kira",
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      logTTS("mithra.stream.fragment.http-error", { status: res.status });
      return null;
    }
    return await res.arrayBuffer();
  } catch (e: any) {
    // AbortError here means the hang detector fired — log it distinctly so we can see
    // server hangs in telemetry without conflating with real network failures.
    const err = String(e?.name === "AbortError" ? "hang-detected" : e?.message || e);
    logTTS("mithra.stream.fragment.fetch-error", { err });
    return null;
  } finally {
    clearTimeout(hangTimer);
  }
}

async function playWavBuffer(audioData: ArrayBuffer, tempName: string): Promise<void> {
  const bytes = new Uint8Array(audioData);
  let base64 = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    base64 += String.fromCharCode(...bytes.slice(i, i + 8192));
  }
  base64 = btoa(base64);
  const tempPath = `${FileSystem.cacheDirectory}${tempName}`;
  await FileSystem.writeAsStringAsync(tempPath, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const { sound } = await Audio.Sound.createAsync({ uri: tempPath }, { shouldPlay: true });
  state.currentSound = sound;
  await new Promise<void>((resolve) => {
    sound.setOnPlaybackStatusUpdate((status: any) => {
      if (status.didJustFinish) {
        sound.unloadAsync().catch(() => {});
        resolve();
      }
    });
  });
}

async function speakWithMithra(text: string): Promise<boolean> {
  if (!FileSystem) {
    logTTS("mithra.synth.skip", { reason: "no-filesystem" });
    return false;
  }
  if (state.isSpeaking) await stop();
  state.isSpeaking = true;

  const t0 = Date.now();
  const sentences = splitSentences(text);
  logTTS("mithra.stream.start", { chars: text.length, fragments: sentences.length });

  // Pipeline depth 2: at most one fragment synthesizing while another plays.
  // Mithra has one GPU; firing N parallel requests just time-slices it and makes each
  // N× slower (learned the hard way in v1.10.0). So we prefetch exactly one ahead.
  try {
    let firstPlayed = false;
    let nextTask: Promise<ArrayBuffer | null> | null = null;

    for (let i = 0; i < sentences.length; i++) {
      // Use the already-in-flight prefetch if present, otherwise start synth for i.
      const currentTask = nextTask ?? synthMithraFragment(sentences[i]).catch(() => null);
      // Prefetch i+1 while we wait for i (and then play it).
      nextTask = i + 1 < sentences.length
        ? synthMithraFragment(sentences[i + 1]).catch(() => null)
        : null;

      const audioBuf = await currentTask;
      if (!audioBuf) {
        logTTS("mithra.stream.fragment.failed", { idx: i });
        if (i === 0 && !firstPlayed) {
          state.isSpeaking = false;
          return false;
        }
        continue;
      }

      if (!firstPlayed) {
        logTTS("mithra.stream.first-audio", { ms: Date.now() - t0, idx: i });
        firstPlayed = true;
      }

      await playWavBuffer(audioBuf, `kira-mithra-${i}.wav`);
    }
    state.isSpeaking = false;
    state.currentSound = null;
    logTTS("mithra.stream.done", { ms: Date.now() - t0, fragments: sentences.length });
    return firstPlayed;
  } catch (e: any) {
    logTTS("mithra.stream.exception", { err: String(e?.message || e), ms: Date.now() - t0 });
    console.warn("[KiraTTS] Mithra streaming error:", e?.message || e);
    state.isSpeaking = false;
    return false;
  }
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
        ref_audio: currentSpeaker === "qwenboy" ? qwenRefAudioBase64 : currentSpeaker === "riffbot" ? riffRefAudioBase64 : refAudioBase64,
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
  if (state.isInitialized && refAudioBase64) return "mithra";
  if (state.isInitialized) return "elevenlabs";
  if (Speech) return "system";
  return "none";
}

export function isSpeaking(): boolean {
  return state.isSpeaking;
}
