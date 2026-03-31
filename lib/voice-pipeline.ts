/**
 * Kira Voice Pipeline — On-device VAD → STT → LLM → TTS
 *
 * Adapted from Polyglot's useGeminiLive + useOfflineVoice hooks.
 * Runs entirely on-device when possible, falls back to cloud APIs.
 *
 * Pipeline:
 * 1. Silero VAD (ExecuTorch) detects speech start/end
 * 2. Whisper Tiny (on-device) or backend API transcribes speech
 * 3. Kira backend processes message (Claude CLI or API)
 * 4. Piper TTS (on-device, Kira voice) or expo-speech speaks response
 */

import { Platform } from "react-native";

// Types
export interface VoicePipelineConfig {
  /** Use on-device Silero VAD (requires native build) */
  useLocalVAD: boolean;
  /** Use on-device Whisper STT (requires native build) */
  useLocalSTT: boolean;
  /** Use on-device Piper TTS with Kira voice (requires native build) */
  useLocalTTS: boolean;
  /** Backend URL for cloud fallbacks */
  backendUrl: string;
  /** Callback when transcription is ready */
  onTranscription: (text: string) => void;
  /** Callback for pipeline state changes */
  onStateChange: (state: PipelineState) => void;
}

export type PipelineState =
  | "idle"           // Not listening
  | "listening"      // VAD active, waiting for speech
  | "recording"      // Speech detected, recording
  | "transcribing"   // Processing audio to text
  | "thinking"       // Waiting for LLM response
  | "speaking"       // TTS playing response
  | "error";         // Something went wrong

export interface VoicePipelineHandle {
  start: () => Promise<void>;
  stop: () => void;
  speak: (text: string) => Promise<void>;
  state: PipelineState;
}

/**
 * Check which on-device capabilities are available.
 * Returns what we can run locally vs what needs cloud fallback.
 */
export async function checkCapabilities(): Promise<{
  hasVAD: boolean;
  hasSTT: boolean;
  hasTTS: boolean;
  hasMic: boolean;
}> {
  const result = { hasVAD: false, hasSTT: false, hasTTS: false, hasMic: false };

  if (Platform.OS === "web") return result;

  // Check microphone
  try {
    const Audio = require("expo-av").Audio;
    const { granted } = await Audio.requestPermissionsAsync();
    result.hasMic = granted;
  } catch {
    // expo-av not available
  }

  // Check Silero VAD
  try {
    const { loadSileroExecuTorch } = require("@/lib/silero-executorch");
    result.hasVAD = true;
  } catch {
    // ExecuTorch not available — will use adaptive metering fallback
  }

  // Check Whisper
  try {
    // TODO: Add whisper.rn check
    result.hasSTT = false;
  } catch {
    result.hasSTT = false;
  }

  // Check Piper TTS
  try {
    // TODO: Check if Kira voice model is downloaded
    result.hasTTS = false;
  } catch {
    result.hasTTS = false;
  }

  return result;
}

/**
 * Context sync — push conversation summary to desktop Kira.
 * Uses Supabase Realtime or webhook to inject context immediately.
 */
export async function syncToDesktop(
  summary: string,
  actionItems: string[],
  supabaseUrl: string,
  supabaseKey: string,
): Promise<void> {
  try {
    const { createClient } = require("@supabase/supabase-js");
    const supabase = createClient(supabaseUrl, supabaseKey);

    await supabase.from("context_sync").insert({
      source: "phone",
      type: "conversation_summary",
      content: JSON.stringify({ summary, actionItems }),
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn("[ContextSync] Failed to sync to desktop:", error);
  }
}

/**
 * Pull latest desktop context for phone Kira.
 */
export async function pullFromDesktop(
  supabaseUrl: string,
  supabaseKey: string,
): Promise<{ summary: string; actionItems: string[] } | null> {
  try {
    const { createClient } = require("@supabase/supabase-js");
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data } = await supabase
      .from("context_sync")
      .select("content")
      .eq("source", "desktop")
      .order("created_at", { ascending: false })
      .limit(1);

    if (data?.[0]?.content) {
      return JSON.parse(data[0].content);
    }
    return null;
  } catch {
    return null;
  }
}
