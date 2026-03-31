# Kira App — Project Rules

React Native mobile app for Kira AI companion.

## Stack
- Expo 55 / React Native 0.83 / React 19
- Supabase (auth, realtime DB, message subscriptions)
- Silero ExecuTorch neural VAD (on-device speech detection)
- expo-audio-studio for recording, expo-av for playback
- Piper TTS for voice synthesis
- KiraOrb component (teal-to-cyan animated orb — Kira chose this color)

## Key Files
- `App.tsx` — Main chat UI with voice I/O pipeline
- `lib/useVoiceMode.ts` — Voice recording + transcription orchestrator
- `lib/voice-pipeline.ts` — Audio VAD
- `lib/piper-tts.ts` — TTS integration
- `lib/KiraOrb.tsx` — Visual identity component
- `lib/context-sync.ts` — Phone ↔ desktop context sync
- `lib/useRealtimeMessages.ts` — WebSocket message subscriptions
- `lib/supabase.ts` — DB client
- `mcp-chess/` — Chess MCP server

## Protected Files
`src/hooks/useGeminiLive.ts` contains the Silero ExecuTorch neural VAD pipeline. See `~/.claude/rules/useGeminiLive-protection.md` for mandatory pre/post edit checks. This file has been accidentally destroyed twice. NEVER write the whole file — surgical edits only.

## Build
- EAS development builds: `eas build --profile development --platform android`
- APK builds are in the root directory (keep only 3 most recent)
- Crash debugging: `adb logcat` during device testing

## Git
Commit locally as needed. Only push when explicitly asked.
