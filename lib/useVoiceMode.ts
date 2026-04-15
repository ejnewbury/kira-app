/**
 * useVoiceMode — Voice interaction for Kira app.
 *
 * Pipeline: expo-audio-studio (16kHz PCM) → Silero VAD (speech detection)
 *   → accumulate audio during speech → on silence → Whisper transcribe on-device
 *   → onTranscription callback → TTS response
 *
 * Fallback: metering VAD + backend transcription if native modules unavailable.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { Audio } from "expo-av";
import { base64ToInt16Array, int16ToFloat32, initAudioMode, requestMicPermission } from "./audio-helpers";
import { loadSileroVAD, detectSpeech, resetState as resetSileroState, unloadSilero } from "./silero-vad";
import * as PiperTTS from "./piper-tts";

let FileSystem: any = null;
try { FileSystem = require("expo-file-system"); } catch {}

let useAudioRecorder: any = null;
try { useAudioRecorder = require("@siteed/expo-audio-studio").useAudioRecorder; } catch {}

let SpeechToTextModule: any = null;
let WHISPER_MODEL: any = null;
try {
  const et = require("react-native-executorch");
  SpeechToTextModule = et.SpeechToTextModule;
  // Whisper Tiny multilingual — Base EN has inference issues on this device
  // TODO: test WHISPER_BASE once react-native-executorch fixes forward() compat
  WHISPER_MODEL = et.WHISPER_TINY;
} catch {}

export type VoiceState = "idle" | "listening" | "recording" | "transcribing" | "thinking" | "speaking";
type VADEngine = "silero" | "metering";

interface UseVoiceModeOptions {
  onTranscription: (text: string) => void;
  backendUrl?: string;
}

interface UseVoiceModeReturn {
  state: VoiceState;
  vadEngine: VADEngine;
  ttsEngine: "mithra" | "voxtral" | "elevenlabs" | "system" | "none";
  isActive: boolean;
  audioLevel: number;
  start: () => Promise<void>;
  stop: () => void;
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => void;
}

// Silero VAD config
const SPEECH_THRESHOLD = 0.6;   // Raised from 0.5 — reduces false triggers from system sounds
const SILENCE_THRESHOLD = 0.35;
const CONFIRM_FRAMES = 5;       // Raised from 3 — requires ~180ms of confirmed speech (vs 108ms)
const SILENCE_TIMEOUT_MS = 1500;
const MIN_SPEECH_MS = 600;      // Raised from 400ms — short pings/dings won't qualify
const FRAME_SIZE = 576; // 576 samples @ 16kHz = 36ms per frame

// Metering fallback config
const METERING_SILENCE_MS = 1500;
const METERING_MIN_SPEECH_MS = 500;
const NOISE_FLOOR_INITIAL = -55;
const NOISE_FLOOR_MAX = -60;
const NOISE_FLOOR_MIN = -130;

export function useVoiceMode(options: UseVoiceModeOptions): UseVoiceModeReturn {
  const { onTranscription, backendUrl } = options;

  const [state, setState] = useState<VoiceState>("idle");
  const [vadEngine, setVadEngine] = useState<VADEngine>("metering");
  const stateRef = useRef<VoiceState>("idle");
  const isActiveRef = useRef(false);
  const onTranscriptionRef = useRef(onTranscription);
  const audioLevelRef = useRef(0);

  useEffect(() => { onTranscriptionRef.current = onTranscription; }, [onTranscription]);

  // Whisper STT
  const whisperRef = useRef<any>(null);
  const whisperLoadingRef = useRef(false);

  // Silero VAD state
  const speechFramesRef = useRef(0);
  const silenceFramesRef = useRef(0);
  const isSpeechRef = useRef(false);
  const speechStartRef = useRef(0);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rawAudioRef = useRef<Float32Array[]>([]);
  const frameAccRef = useRef<Float32Array>(new Float32Array(0));

  // Audio studio (Silero path) — must call hook at top level
  const audioStudio = useAudioRecorder ? useAudioRecorder() : null;
  const audioStudioRef = useRef<any>(null);

  // Metering fallback refs
  const recordingRef = useRef<Audio.Recording | null>(null);
  const meteringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noiseFloorRef = useRef(NOISE_FLOOR_INITIAL);
  const recentMeteringsRef = useRef<number[]>([]);
  const meteringSpeechStartRef = useRef(0);
  const meteringSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setVoiceState = useCallback((s: VoiceState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  useEffect(() => { return () => { stop(); }; }, []);

  // ═══════════════════════════════════════
  // WHISPER LOCAL TRANSCRIPTION
  // ═══════════════════════════════════════

  const loadWhisper = useCallback(async (): Promise<boolean> => {
    if (whisperRef.current) return true;
    if (whisperLoadingRef.current) return false;
    if (!SpeechToTextModule || !WHISPER_MODEL) {
      console.log("[VoiceMode] Whisper not available (no SpeechToTextModule)");
      return false;
    }

    whisperLoadingRef.current = true;
    try {
      const whisper = new SpeechToTextModule();
      await whisper.load(WHISPER_MODEL);
      whisperRef.current = whisper;
      console.log("[VoiceMode] Whisper loaded");
      return true;
    } catch (e: any) {
      console.warn("[VoiceMode] Whisper load failed:", e.message);
      return false;
    } finally {
      whisperLoadingRef.current = false;
    }
  }, []);

  const transcribeLocal = useCallback(async (frames: Float32Array[]): Promise<string | null> => {
    if (!whisperRef.current || frames.length === 0) return null;

    const totalSamples = frames.reduce((sum, f) => sum + f.length, 0);

    // Concatenate all frames
    const fullWaveform = new Float32Array(totalSamples);
    let offset = 0;
    for (const frame of frames) {
      fullWaveform.set(frame, offset);
      offset += frame.length;
    }

    const totalSeconds = totalSamples / 16000;
    console.log(`[VoiceMode] Transcribing ${totalSeconds.toFixed(1)}s audio locally...`);

    // Whisper Tiny handles up to ~28s well. For longer, chunk into segments.
    const CHUNK_SAMPLES = 16000 * 28;

    try {
      if (totalSamples <= CHUNK_SAMPLES) {
        const text = await whisperRef.current.transcribe(fullWaveform, { language: "en" });
        return text?.trim() || null;
      } else {
        // Chunk transcription for long utterances
        const parts: string[] = [];
        for (let start = 0; start < totalSamples; start += CHUNK_SAMPLES) {
          const end = Math.min(start + CHUNK_SAMPLES, totalSamples);
          const chunk = fullWaveform.subarray(start, end);
          const text = await whisperRef.current.transcribe(chunk, { language: "en" });
          if (text?.trim()) parts.push(text.trim());
        }
        return parts.join(" ") || null;
      }
    } catch (e: any) {
      console.warn("[VoiceMode] Local transcription failed:", e.message);
      // Reload Whisper after failure — model may be in bad state
      whisperRef.current = null;
      loadWhisper().catch(() => {});
      return null;
    }
  }, []);

  // ═══════════════════════════════════════
  // SILERO VAD PATH (primary)
  // ═══════════════════════════════════════

  const handleSpeechEnd = useCallback(async () => {
    if (!isSpeechRef.current) return;
    isSpeechRef.current = false;
    speechFramesRef.current = 0;
    silenceFramesRef.current = 0;

    const frames = rawAudioRef.current;
    rawAudioRef.current = [];

    if (frames.length === 0) {
      if (isActiveRef.current) setVoiceState("listening");
      return;
    }

    setVoiceState("transcribing");

    // Concatenate raw PCM frames
    const totalSamples = frames.reduce((sum, f) => sum + f.length, 0);
    const totalSeconds = totalSamples / 16000;
    console.log(`[VoiceMode] Transcribing ${totalSeconds.toFixed(1)}s via API...`);

    if (totalSeconds < 0.5) {
      console.log("[VoiceMode] Too short, skipping");
      resetSileroState();
      if (isActiveRef.current) setVoiceState("listening");
      return;
    }

    // Encode Float32 PCM → Int16 → WAV → base64 for API
    const int16 = new Int16Array(totalSamples);
    let offset = 0;
    for (const frame of frames) {
      for (let i = 0; i < frame.length; i++) {
        int16[offset++] = Math.max(-32768, Math.min(32767, Math.round(frame[i] * 32767)));
      }
    }

    // WAV header
    const wavBuffer = new ArrayBuffer(44 + int16.length * 2);
    const view = new DataView(wavBuffer);
    const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + int16.length * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, 16000, true); // sample rate
    view.setUint32(28, 32000, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    writeStr(36, "data");
    view.setUint32(40, int16.length * 2, true);
    new Int16Array(wavBuffer, 44).set(int16);

    // Base64 encode
    const bytes = new Uint8Array(wavBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    try {
      const url = backendUrl || "https://kira-backend-six.vercel.app";
      const res = await fetch(`${url}/api/kira/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64, format: "wav" }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      const text = data.text?.trim();
      console.log("[VoiceMode] API transcription:", JSON.stringify(text?.slice(0, 100)));

      if (text && text.length > 1) {
        onTranscriptionRef.current(text);
      } else {
        console.log("[VoiceMode] API returned empty");
      }
    } catch (e: any) {
      console.warn("[VoiceMode] API transcription failed:", e.message);
    }

    resetSileroState();
    if (isActiveRef.current) setVoiceState("listening");
  }, [setVoiceState, backendUrl]);

  const processChunk = useCallback(async (pcm: Float32Array) => {
    if (!isActiveRef.current) return;

    // Compute RMS amplitude from raw PCM for smooth analog visualization
    let sumSq = 0;
    for (let i = 0; i < pcm.length; i++) sumSq += pcm[i] * pcm[i];
    const rms = Math.sqrt(sumSq / pcm.length);
    // Map RMS to 0-1 range with some headroom (typical speech RMS ~0.02-0.15)
    const rawLevel = Math.min(1, rms * 10);
    // Smooth it — fast attack, slow decay for natural feel
    if (rawLevel > audioLevelRef.current) {
      audioLevelRef.current = audioLevelRef.current * 0.5 + rawLevel * 0.5; // Fast attack
    } else {
      audioLevelRef.current = audioLevelRef.current * 0.85 + rawLevel * 0.15; // Slow decay
    }

    // Save raw audio while speech is active
    if (isSpeechRef.current || speechFramesRef.current > 0) {
      rawAudioRef.current.push(new Float32Array(pcm));
    }

    // Accumulate into frame buffer
    const prev = frameAccRef.current;
    const combined = new Float32Array(prev.length + pcm.length);
    combined.set(prev);
    combined.set(pcm, prev.length);
    frameAccRef.current = combined;

    // Process complete 576-sample frames
    while (frameAccRef.current.length >= FRAME_SIZE) {
      const frame = frameAccRef.current.slice(0, FRAME_SIZE);
      frameAccRef.current = frameAccRef.current.slice(FRAME_SIZE);

      const prob = await detectSpeech(frame);
      if (prob < 0) continue;

      if (prob >= SPEECH_THRESHOLD) {
        speechFramesRef.current++;
        silenceFramesRef.current = 0;

        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }

        if (!isSpeechRef.current && speechFramesRef.current >= CONFIRM_FRAMES) {
          isSpeechRef.current = true;
          speechStartRef.current = Date.now();
          setVoiceState("recording");
          console.log("[VoiceMode] Speech detected");
        }
      } else if (prob <= SILENCE_THRESHOLD) {
        silenceFramesRef.current++;
        speechFramesRef.current = 0;

        if (isSpeechRef.current && silenceFramesRef.current >= CONFIRM_FRAMES && !silenceTimerRef.current) {
          const dur = Date.now() - speechStartRef.current;
          if (dur >= MIN_SPEECH_MS) {
            silenceTimerRef.current = setTimeout(() => {
              silenceTimerRef.current = null;
              handleSpeechEnd();
            }, SILENCE_TIMEOUT_MS);
          } else {
            // Too short, reset
            isSpeechRef.current = false;
            speechFramesRef.current = 0;
            silenceFramesRef.current = 0;
            rawAudioRef.current = [];
            setVoiceState("listening");
          }
        }
      }
    }
  }, [handleSpeechEnd, setVoiceState]);

  // ═══════════════════════════════════════
  // METERING VAD PATH (fallback)
  // ═══════════════════════════════════════

  const updateNoiseFloor = useCallback((metering: number) => {
    if (stateRef.current === "recording" && metering > -90) return;
    recentMeteringsRef.current.push(metering);
    if (recentMeteringsRef.current.length > 50) recentMeteringsRef.current.shift();
    const sorted = [...recentMeteringsRef.current].sort((a, b) => a - b);
    const raw = sorted[Math.floor(sorted.length * 0.2)] ?? NOISE_FLOOR_INITIAL;
    noiseFloorRef.current = Math.max(Math.min(raw, NOISE_FLOOR_MAX), NOISE_FLOOR_MIN);
  }, []);

  const handleMeteringSpeechEnd = useCallback(async () => {
    if (!recordingRef.current) return;
    setVoiceState("transcribing");

    if (meteringIntervalRef.current) {
      clearInterval(meteringIntervalRef.current);
      meteringIntervalRef.current = null;
    }

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (uri) {
        // Try local Whisper first, fall back to backend
        let text: string | null = null;
        if (whisperRef.current) {
          try {
            // Read WAV file via expo-file-system (fetch doesn't work for local URIs on Android)
            const base64Data = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
            const binaryStr = atob(base64Data);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
            // Skip WAV header (44 bytes), convert int16 PCM to float32
            const int16 = new Int16Array(bytes.buffer, 44);
            const float32 = new Float32Array(int16.length);
            for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
            text = await whisperRef.current.transcribe(float32, { language: "en" });
            text = text?.trim() || null;
            if (text) console.log("[VoiceMode] Local Whisper transcribed:", text.slice(0, 60));
          } catch (e: any) {
            console.warn("[VoiceMode] Local Whisper failed, trying backend:", e.message);
          }
        }
        if (!text) {
          text = await transcribeFileAudio(uri);
        }
        if (text?.trim()) onTranscriptionRef.current(text.trim());
      }
      if (isActiveRef.current) { setVoiceState("listening"); startMetering(); }
    } catch {
      if (isActiveRef.current) { setVoiceState("listening"); startMetering(); }
    }
  }, []);

  const startMetering = useCallback(async () => {
    setVadEngine("metering");
    console.log("[VoiceMode] Starting metering VAD fallback");

    const { recording } = await Audio.Recording.createAsync({
      ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
      android: {
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android,
        extension: ".wav",
        outputFormat: Audio.AndroidOutputFormat.DEFAULT,
        audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
      },
      ios: {
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY.ios,
        extension: ".wav",
        outputFormat: Audio.IOSOutputFormat.LINEARPCM,
        audioQuality: Audio.IOSAudioQuality.HIGH,
      },
      isMeteringEnabled: true,
    });

    recordingRef.current = recording;

    meteringIntervalRef.current = setInterval(async () => {
      if (!isActiveRef.current || !recordingRef.current) return;
      try {
        const status = await recordingRef.current.getStatusAsync();
        if (!status.isRecording) return;

        const metering = (status as any).metering ?? -160;
        updateNoiseFloor(metering);

        const threshold = noiseFloorRef.current + 12;
        const isSpeech = metering > threshold;
        audioLevelRef.current = Math.max(0, Math.min(1, (metering + 160) / 120));

        if (isSpeech) {
          if (stateRef.current !== "recording") {
            meteringSpeechStartRef.current = Date.now();
            setVoiceState("recording");
            console.log("[VoiceMode] Metering: speech detected");
          }
          if (meteringSilenceTimerRef.current) {
            clearTimeout(meteringSilenceTimerRef.current);
            meteringSilenceTimerRef.current = null;
          }
        } else if (stateRef.current === "recording") {
          if (!meteringSilenceTimerRef.current) {
            meteringSilenceTimerRef.current = setTimeout(() => {
              const dur = Date.now() - meteringSpeechStartRef.current;
              if (dur >= METERING_MIN_SPEECH_MS) {
                handleMeteringSpeechEnd();
              } else {
                setVoiceState("listening");
              }
              meteringSilenceTimerRef.current = null;
            }, METERING_SILENCE_MS);
          }
        }
      } catch {}
    }, 100);
  }, [updateNoiseFloor, handleMeteringSpeechEnd, setVoiceState]);

  // Backend transcription fallback (for metering path)
  async function transcribeFileAudio(uri: string): Promise<string | null> {
    try {
      const formData = new FormData();
      formData.append("file", { uri, name: "recording.wav", type: "audio/wav" } as any);
      const url = backendUrl || "https://kira-backend-six.vercel.app";
      const res = await fetch(`${url}/api/kira/transcribe`, { method: "POST", body: formData });
      if (!res.ok) return null;
      return (await res.json()).text || null;
    } catch { return null; }
  }

  // ═══════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════

  const start = useCallback(async () => {
    if (isActiveRef.current) return;

    const hasMic = await requestMicPermission();
    if (!hasMic) return;
    await initAudioMode();

    isActiveRef.current = true;
    setVoiceState("listening");

    // Try Silero + Whisper (fully on-device)
    if (audioStudio) {
      try {
        const sileroOk = await loadSileroVAD();
        const whisperOk = await loadWhisper();

        if (sileroOk && whisperOk) {
          setVadEngine("silero");
          resetSileroState();
          speechFramesRef.current = 0;
          silenceFramesRef.current = 0;
          isSpeechRef.current = false;
          rawAudioRef.current = [];
          frameAccRef.current = new Float32Array(0);

          // Start the audio stream via expo-audio-studio
          await audioStudio.startRecording({
            sampleRate: 16000,
            channels: 1,
            encoding: "pcm_16bit",
            interval: 100,
            onAudioStream: async (event: any) => {
              if (!isActiveRef.current) return;
              const int16 = base64ToInt16Array(event.data as string);
              const float32 = int16ToFloat32(int16);
              processChunk(float32);
            },
          });

          console.log("[VoiceMode] Silero VAD + Whisper STT — fully on-device");
          return;
        }
      } catch (e: any) {
        console.warn("[VoiceMode] Native pipeline failed:", e.message);
      }
    }

    // Fallback to metering VAD + backend transcription
    try {
      await startMetering();
      console.log("[VoiceMode] Metering VAD + backend transcription (fallback)");
    } catch (e: any) {
      console.error("[VoiceMode] Failed to start any voice mode:", e.message);
      isActiveRef.current = false;
      setVoiceState("idle");
    }
  }, [loadWhisper, processChunk, startMetering, setVoiceState]);

  const stop = useCallback(() => {
    isActiveRef.current = false;
    setVoiceState("idle");

    // Clean up Silero path
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (audioStudio) {
      try { audioStudio.stopRecording(); } catch {}
    }
    unloadSilero();
    rawAudioRef.current = [];
    frameAccRef.current = new Float32Array(0);

    // Clean up metering path
    if (meteringIntervalRef.current) { clearInterval(meteringIntervalRef.current); meteringIntervalRef.current = null; }
    if (meteringSilenceTimerRef.current) { clearTimeout(meteringSilenceTimerRef.current); meteringSilenceTimerRef.current = null; }
    if (recordingRef.current) { recordingRef.current.stopAndUnloadAsync().catch(() => {}); recordingRef.current = null; }

    PiperTTS.stop();
  }, [setVoiceState]);

  const speak = useCallback(async (text: string) => {
    // Stop recording before TTS to avoid audio conflict
    if (audioStudio) {
      try { audioStudio.stopRecording(); } catch {}
    }
    setVoiceState("speaking");
    try {
      await PiperTTS.speak(text);
    } catch {}

    // Restart recording after TTS finishes — TTS kills the audio session
    if (isActiveRef.current && audioStudio) {
      setVoiceState("listening");
      resetSileroState();
      speechFramesRef.current = 0;
      silenceFramesRef.current = 0;
      isSpeechRef.current = false;
      rawAudioRef.current = [];
      frameAccRef.current = new Float32Array(0);
      try {
        await audioStudio.startRecording({
          sampleRate: 16000,
          channels: 1,
          encoding: "pcm_16bit",
          interval: 100,
          onAudioStream: async (event: any) => {
            if (!isActiveRef.current) return;
            const int16 = base64ToInt16Array(event.data as string);
            const float32 = int16ToFloat32(int16);
            processChunk(float32);
          },
        });
        console.log("[VoiceMode] Recording restarted after TTS");
      } catch (e: any) {
        console.warn("[VoiceMode] Failed to restart recording:", e.message);
      }
    } else {
      setVoiceState(isActiveRef.current ? "listening" : "idle");
    }
  }, [setVoiceState, audioStudio, processChunk]);

  const stopSpeaking = useCallback(() => {
    PiperTTS.stop();
    if (stateRef.current === "speaking") setVoiceState(isActiveRef.current ? "listening" : "idle");
  }, [setVoiceState]);

  return {
    state,
    vadEngine,
    ttsEngine: PiperTTS.getActiveEngine(),
    isActive: isActiveRef.current,
    audioLevel: audioLevelRef.current,
    start,
    stop,
    speak,
    stopSpeaking,
  };
}
