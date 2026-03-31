/**
 * useVoiceMode — Main voice interaction hook for Kira app.
 *
 * Dual-path VAD:
 * - PRIMARY: Silero V5 neural VAD via ExecuTorch (dev builds)
 * - FALLBACK: Adaptive metering VAD via expo-av (Expo Go)
 *
 * Pipeline: VAD → Record → Transcribe (backend) → Send → TTS
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { Audio } from "expo-av";
import { initAudioMode, requestMicPermission, base64ToInt16Array, int16ToFloat32, concatenateInt16Arrays, encodeInt16ToWAV, arrayBufferToBase64 } from "./audio-helpers";
import { loadSileroVAD, detectSpeech, resetState as resetSileroState, unloadSilero, isSileroAvailable } from "./silero-vad";

// Piper TTS (Kira's voice) with system TTS fallback
import * as PiperTTS from "./piper-tts";

let useAudioRecorder: any = null;
try { useAudioRecorder = require("@siteed/expo-audio-studio").useAudioRecorder; } catch {}

export type VoiceState = "idle" | "listening" | "recording" | "transcribing" | "thinking" | "speaking";
type VADEngine = "silero" | "metering";

interface UseVoiceModeOptions {
  onTranscription: (text: string) => void;
  onResponse?: (text: string) => void;
  autoSpeak?: boolean;
  backendUrl?: string;
}

interface UseVoiceModeReturn {
  state: VoiceState;
  vadEngine: VADEngine;
  ttsEngine: "voxtral" | "elevenlabs" | "system" | "none";
  isActive: boolean;
  audioLevel: number; // 0-1 normalized audio amplitude for visualization
  start: () => Promise<void>;
  stop: () => void;
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => void;
}

// Silero VAD config
const SILERO_SPEECH_THRESHOLD = 0.5;
const SILERO_SILENCE_FRAMES = 25; // ~900ms at 36ms/frame
const SILERO_MIN_SPEECH_FRAMES = 8; // ~288ms minimum speech

// Metering fallback config
const SILENCE_DURATION_MS = 1500;
const MIN_SPEECH_MS = 500;
const NOISE_FLOOR_INITIAL = -55;

export function useVoiceMode(options: UseVoiceModeOptions): UseVoiceModeReturn {
  const { onTranscription, backendUrl } = options;

  const [state, setState] = useState<VoiceState>("idle");
  const [vadEngine, setVadEngine] = useState<VADEngine>("metering");
  const stateRef = useRef<VoiceState>("idle");
  const isActiveRef = useRef(false);

  // Silero path refs
  const sileroLoadedRef = useRef(false);
  const audioBufferRef = useRef<Int16Array[]>([]);
  const silencFrameCountRef = useRef(0);
  const speechFrameCountRef = useRef(0);
  const frameAccumulatorRef = useRef<Float32Array>(new Float32Array(0));

  // Metering path refs
  const recordingRef = useRef<Audio.Recording | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noiseFloorRef = useRef(NOISE_FLOOR_INITIAL);
  const recentMeteringsRef = useRef<number[]>([]);
  const speechStartRef = useRef<number>(0);
  const meteringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioLevelRef = useRef<number>(0);

  // Audio studio for Silero path
  const audioStudioRef = useRef<any>(null);

  const setVoiceState = useCallback((newState: VoiceState) => {
    stateRef.current = newState;
    setState(newState);
  }, []);

  useEffect(() => {
    return () => { stop(); };
  }, []);

  // ═══════════════════════════════════════
  // SILERO VAD PATH (primary)
  // ═══════════════════════════════════════

  const processFrames = useCallback(async (audioData: Int16Array) => {
    // Accumulate into 576-sample frames for Silero
    const float32 = int16ToFloat32(audioData);
    const accumulated = new Float32Array(frameAccumulatorRef.current.length + float32.length);
    accumulated.set(frameAccumulatorRef.current);
    accumulated.set(float32, frameAccumulatorRef.current.length);
    frameAccumulatorRef.current = accumulated;

    while (frameAccumulatorRef.current.length >= 576) {
      const frame = frameAccumulatorRef.current.slice(0, 576);
      frameAccumulatorRef.current = frameAccumulatorRef.current.slice(576);

      const prob = await detectSpeech(frame);
      if (prob < 0) continue; // Inference failed or busy

      if (prob >= SILERO_SPEECH_THRESHOLD) {
        speechFrameCountRef.current++;
        silencFrameCountRef.current = 0;

        if (stateRef.current === "listening") {
          setVoiceState("recording");
        }
      } else {
        if (stateRef.current === "recording") {
          silencFrameCountRef.current++;

          if (silencFrameCountRef.current >= SILERO_SILENCE_FRAMES) {
            if (speechFrameCountRef.current >= SILERO_MIN_SPEECH_FRAMES) {
              handleSileroSpeechEnd();
            } else {
              // Too short — reset
              speechFrameCountRef.current = 0;
              silencFrameCountRef.current = 0;
              setVoiceState("listening");
            }
          }
        }
      }
    }
  }, []);

  const startSilero = useCallback(async () => {
    if (!useAudioRecorder) {
      console.warn("[VoiceMode] expo-audio-studio not available, falling back to metering");
      return false;
    }

    try {
      const sileroOk = await loadSileroVAD();
      if (!sileroOk) {
        console.warn("[VoiceMode] Silero not available, falling back to metering");
        return false;
      }

      sileroLoadedRef.current = true;
      setVadEngine("silero");
      resetSileroState();
      audioBufferRef.current = [];
      speechFrameCountRef.current = 0;
      silencFrameCountRef.current = 0;
      frameAccumulatorRef.current = new Float32Array(0);

      // Start audio stream via expo-audio-studio
      // The audioStudio instance needs to be created in the component
      // For now, we'll use it if passed in, otherwise fall back
      console.log("[VoiceMode] Silero VAD active — neural speech detection");
      return true;
    } catch (e) {
      console.warn("[VoiceMode] Silero init failed:", e);
      return false;
    }
  }, []);

  const handleSileroSpeechEnd = useCallback(async () => {
    setVoiceState("transcribing");

    // Build WAV from accumulated audio buffer
    const allAudio = concatenateInt16Arrays(audioBufferRef.current);
    audioBufferRef.current = [];
    speechFrameCountRef.current = 0;
    silencFrameCountRef.current = 0;

    if (allAudio.length < 1600) { // Less than 100ms
      setVoiceState("listening");
      return;
    }

    try {
      const wavBuffer = encodeInt16ToWAV(allAudio, 16000);
      const base64 = arrayBufferToBase64(wavBuffer);

      // Transcribe
      const text = await transcribeBase64Audio(base64);
      if (text?.trim()) {
        onTranscription(text.trim());
      }

      if (isActiveRef.current) {
        setVoiceState("listening");
      }
    } catch (error) {
      console.error("[VoiceMode] Silero transcription failed:", error);
      if (isActiveRef.current) setVoiceState("listening");
    }
  }, [onTranscription]);

  // ═══════════════════════════════════════
  // METERING VAD PATH (fallback)
  // ═══════════════════════════════════════

  const NOISE_FLOOR_MAX = -60; // Never let floor rise above this
  const NOISE_FLOOR_MIN = -130; // Never let floor drop below this — -160 means "no data yet"

  const updateNoiseFloor = useCallback((metering: number) => {
    // During recording, only accept clearly-silent samples (below -90dB) for floor calibration
    if (stateRef.current === "recording" && metering > -90) return;
    recentMeteringsRef.current.push(metering);
    if (recentMeteringsRef.current.length > 50) recentMeteringsRef.current.shift();
    const sorted = [...recentMeteringsRef.current].sort((a, b) => a - b);
    const raw = sorted[Math.floor(sorted.length * 0.2)] ?? NOISE_FLOOR_INITIAL;
    noiseFloorRef.current = Math.max(Math.min(raw, NOISE_FLOOR_MAX), NOISE_FLOOR_MIN);
  }, []);

  const startMetering = useCallback(async () => {
    setVadEngine("metering");

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

        // Normalize metering (-160 to 0 dBFS) to 0-1 for visualization
        audioLevelRef.current = Math.max(0, Math.min(1, (metering + 160) / 120));

        // Debug: log every 10th reading
        if (Math.random() < 0.1) {
          console.log(`[VAD] metering=${metering.toFixed(1)} floor=${noiseFloorRef.current.toFixed(1)} threshold=${threshold.toFixed(1)} speech=${isSpeech}`);
        }

        if (isSpeech) {
          if (stateRef.current !== "recording") {
            console.log("[VAD] Speech detected — transitioning to recording");
            speechStartRef.current = Date.now();
            setVoiceState("recording");
          }
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else if (stateRef.current === "recording") {
          if (!silenceTimerRef.current) {
            console.log("[VAD] Silence detected — starting end-of-speech timer");
            silenceTimerRef.current = setTimeout(() => {
              const dur = Date.now() - speechStartRef.current;
              console.log(`[VAD] Speech ended, duration=${dur}ms (min=${MIN_SPEECH_MS}ms)`);
              if (dur >= MIN_SPEECH_MS) {
                handleMeteringSpeechEnd();
              } else {
                console.log("[VAD] Too short, ignoring");
                setVoiceState("listening");
              }
              silenceTimerRef.current = null;
            }, SILENCE_DURATION_MS);
          }
        }
      } catch {}
    }, 100);
  }, []);

  const handleMeteringSpeechEnd = useCallback(async () => {
    if (!recordingRef.current) return;
    console.log("[VAD] handleMeteringSpeechEnd — stopping recording, transcribing...");
    setVoiceState("transcribing");

    if (meteringIntervalRef.current) {
      clearInterval(meteringIntervalRef.current);
      meteringIntervalRef.current = null;
    }

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (!uri) {
        if (isActiveRef.current) { setVoiceState("listening"); start(); }
        return;
      }

      const text = await transcribeFileAudio(uri);
      if (text?.trim()) onTranscription(text.trim());

      if (isActiveRef.current) { setVoiceState("listening"); start(); }
    } catch {
      if (isActiveRef.current) { setVoiceState("listening"); start(); }
    }
  }, [onTranscription]);

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

    // Try Silero first, fall back to metering
    const sileroOk = await startSilero();
    if (!sileroOk) {
      try {
        await startMetering();
      } catch (error) {
        console.error("[VoiceMode] Failed to start:", error);
        isActiveRef.current = false;
        setVoiceState("idle");
      }
    }
  }, []);

  const stop = useCallback(() => {
    isActiveRef.current = false;
    setVoiceState("idle");

    // Clean up metering path
    if (meteringIntervalRef.current) { clearInterval(meteringIntervalRef.current); meteringIntervalRef.current = null; }
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (recordingRef.current) { recordingRef.current.stopAndUnloadAsync().catch(() => {}); recordingRef.current = null; }

    // Clean up Silero path
    if (sileroLoadedRef.current) {
      unloadSilero();
      sileroLoadedRef.current = false;
    }
    audioBufferRef.current = [];

    PiperTTS.stop();
  }, []);

  const speak = useCallback(async (text: string) => {
    setVoiceState("speaking");
    try {
      await PiperTTS.speak(text);
    } catch {
      // Fallback handled inside PiperTTS
    }
    setVoiceState(isActiveRef.current ? "listening" : "idle");
  }, []);

  const stopSpeaking = useCallback(() => {
    PiperTTS.stop();
    if (stateRef.current === "speaking") setVoiceState(isActiveRef.current ? "listening" : "idle");
  }, []);

  // ═══════════════════════════════════════
  // TRANSCRIPTION
  // ═══════════════════════════════════════

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

  async function transcribeBase64Audio(base64Wav: string): Promise<string | null> {
    try {
      const url = backendUrl || "https://kira-backend-six.vercel.app";
      const res = await fetch(`${url}/api/kira/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64Wav, format: "wav" }),
      });
      if (!res.ok) return null;
      return (await res.json()).text || null;
    } catch { return null; }
  }

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
