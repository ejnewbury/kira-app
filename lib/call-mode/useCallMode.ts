/**
 * useCallMode — WebRTC client for real-time voice calls with active Kira.
 *
 * Pipeline (phone-side, simple):
 *   Mic → MediaStream → RTCPeerConnection (sender)
 *   RTCPeerConnection (receiver) → RTCAudioElement → speaker
 *
 * The Mithra voice-bridge does ALL the heavy lifting server-side:
 *   - Silero VAD (speech-end detection)
 *   - Distil-Whisper STT
 *   - kira-channel routing → active Claude Code session
 *   - Inworld TTS → PCM audio back over the same peer connection
 *
 * Bridge: https://mithra.tail9667d2.ts.net:8004
 *   - POST /call/offer  (SDP exchange — non-trickle ICE)
 *   - POST /call/end    (hangup signal)
 *   - GET  /health
 *
 * Auth: X-Kira-Api-Key header (KIRA_VOICE_BRIDGE_TOKEN)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  MediaStream,
} from "react-native-webrtc";
import logger from "../logger";

export type CallState = "idle" | "connecting" | "connected" | "ending" | "ended" | "error";

interface UseCallModeOptions {
  bridgeUrl?: string;       // default: process.env.EXPO_PUBLIC_KIRA_VOICE_BRIDGE_URL
  bridgeToken?: string;     // default: process.env.EXPO_PUBLIC_KIRA_VOICE_BRIDGE_TOKEN
  languageHint?: string;    // BCP-47, e.g. "en-US" — passed to STT
  onSpeaking?: (speaking: boolean) => void;
  onError?: (err: Error) => void;
}

interface UseCallModeReturn {
  state: CallState;
  callDurationSec: number;
  isMuted: boolean;
  errorMessage: string | null;
  startCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
}

const DEFAULT_BRIDGE_URL =
  process.env.EXPO_PUBLIC_KIRA_VOICE_BRIDGE_URL ??
  "https://mithra.tail9667d2.ts.net:8004";

const DEFAULT_BRIDGE_TOKEN =
  process.env.EXPO_PUBLIC_KIRA_VOICE_BRIDGE_TOKEN ?? "";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
];

export function useCallMode(options: UseCallModeOptions = {}): UseCallModeReturn {
  const {
    bridgeUrl = DEFAULT_BRIDGE_URL,
    bridgeToken = DEFAULT_BRIDGE_TOKEN,
    languageHint = "en-US",
    onSpeaking,
    onError,
  } = options;

  const [state, setState] = useState<CallState>("idle");
  const [callDurationSec, setCallDurationSec] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const callStartTimeRef = useRef<number | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((t) => t.stop());
      remoteStreamRef.current = null;
    }
    if (pcRef.current) {
      try { pcRef.current.close(); } catch {}
      pcRef.current = null;
    }
    sessionIdRef.current = null;
    callStartTimeRef.current = null;
  }, []);

  const reportError = useCallback(
    (msg: string, err?: unknown) => {
      logger.error(`[call-mode] ${msg}`, err);
      setState("error");
      setErrorMessage(msg);
      const error = err instanceof Error ? err : new Error(msg);
      onError?.(error);
      cleanup();
    },
    [cleanup, onError]
  );

  const startCall = useCallback(async () => {
    if (state === "connecting" || state === "connected") {
      logger.warn("[call-mode] startCall called but already connecting/connected");
      return;
    }

    if (!bridgeToken) {
      reportError("Missing KIRA_VOICE_BRIDGE_TOKEN — cannot authenticate to bridge");
      return;
    }

    setState("connecting");
    setErrorMessage(null);

    try {
      // 1. Get mic
      const localStream = await mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      localStreamRef.current = localStream as MediaStream;

      // 2. Create peer connection
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      // 3. Wire local audio track outbound
      localStream.getAudioTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      // 4. Handle inbound audio
      // @ts-expect-error react-native-webrtc event type
      pc.addEventListener("track", (event: any) => {
        logger.info("[call-mode] inbound track received");
        if (event.streams && event.streams[0]) {
          remoteStreamRef.current = event.streams[0];
          // The MediaStream auto-plays through device speaker on RN-WebRTC
          onSpeaking?.(true);
        }
      });

      // @ts-expect-error event type
      pc.addEventListener("connectionstatechange", () => {
        const cs = pc.connectionState;
        logger.info(`[call-mode] connection state: ${cs}`);
        if (cs === "connected") {
          setState("connected");
          callStartTimeRef.current = Date.now();
          durationTimerRef.current = setInterval(() => {
            if (callStartTimeRef.current) {
              setCallDurationSec(
                Math.floor((Date.now() - callStartTimeRef.current) / 1000)
              );
            }
          }, 1000);
        } else if (cs === "failed" || cs === "disconnected") {
          reportError(`Connection ${cs}`);
        } else if (cs === "closed") {
          setState("ended");
          cleanup();
        }
      });

      // 5. Create offer (non-trickle: wait for ICE gathering complete)
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete (bridge uses non-trickle ICE)
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") return resolve();
        const checkState = () => {
          if (pc.iceGatheringState === "complete") {
            // @ts-expect-error
            pc.removeEventListener("icegatheringstatechange", checkState);
            resolve();
          }
        };
        // @ts-expect-error
        pc.addEventListener("icegatheringstatechange", checkState);
        // Safety timeout — don't hang forever
        setTimeout(resolve, 5000);
      });

      // 6. POST offer to bridge
      const localDesc = pc.localDescription;
      if (!localDesc) {
        throw new Error("No localDescription after ICE gathering");
      }

      const offerResp = await fetch(`${bridgeUrl}/call/offer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Kira-Api-Key": bridgeToken,
        },
        body: JSON.stringify({
          sdp: localDesc.sdp,
          type: localDesc.type,
          language_hint: languageHint,
        }),
      });

      if (!offerResp.ok) {
        const errText = await offerResp.text();
        throw new Error(
          `Bridge /call/offer returned ${offerResp.status}: ${errText.substring(0, 200)}`
        );
      }

      const answer = await offerResp.json();
      sessionIdRef.current = answer.session_id ?? null;

      // 7. Apply remote description
      await pc.setRemoteDescription(
        new RTCSessionDescription({ sdp: answer.sdp, type: answer.type })
      );

      logger.info(
        `[call-mode] handshake complete, session=${sessionIdRef.current}`
      );
    } catch (err) {
      reportError(
        err instanceof Error ? err.message : "Unknown error during call setup",
        err
      );
    }
  }, [
    state,
    bridgeUrl,
    bridgeToken,
    languageHint,
    onSpeaking,
    cleanup,
    reportError,
  ]);

  const endCall = useCallback(async () => {
    if (state === "idle" || state === "ended") return;

    setState("ending");

    const sid = sessionIdRef.current;
    if (sid) {
      try {
        await fetch(`${bridgeUrl}/call/end`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Kira-Api-Key": bridgeToken,
          },
          body: JSON.stringify({ session_id: sid }),
        });
      } catch (err) {
        logger.warn("[call-mode] /call/end POST failed", err);
        // Continue cleanup regardless
      }
    }

    cleanup();
    setState("ended");
    setCallDurationSec(0);
  }, [state, bridgeUrl, bridgeToken, cleanup]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !isMuted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setIsMuted(next);
  }, [isMuted]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    state,
    callDurationSec,
    isMuted,
    errorMessage,
    startCall,
    endCall,
    toggleMute,
  };
}
