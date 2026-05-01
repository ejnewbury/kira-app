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

## Build & Release (READ THIS — saves a session every time)

**Self-hosted "OTA" — there is NO EAS Update / no expo-updates here.** App polls
`kira-backend /api/kira/app-version` on launch, downloads + prompts install if
the version field is newer than `CURRENT_VERSION` in `lib/app-updater.ts`.

### Release flow (full release, goes to GitHub)
1. Bump `CURRENT_VERSION` in `lib/app-updater.ts` AND `versionCode` in `app.json`
2. Run `~/.kira/scripts/kira-app-release.sh [version] [notes]` — builds release
   APK locally via `./gradlew assembleRelease`, uploads to GitHub Releases at
   `ejnewbury/kira-app`, POSTs new version + URL to backend
3. App auto-detects on next launch and prompts install

### Preview flow (Eric's arch only, smaller APK, goes to Supabase Storage)
- Local single-arch (arm64-v8a) build to keep size manageable
- Uploaded to Supabase Storage, version endpoint pointed at the public URL
- No script exists for this yet — typically a manual `./gradlew assembleRelease`
  + Supabase Storage upload + curl to `/api/kira/app-version`. Worth scripting.

### EAS builds (rarely — only when local fails)
- `eas build --profile development --platform android` — dev client APK
- `eas build --profile preview --platform android` — preview, but goes to EAS
  cloud not Supabase, slower than local

### Crash debugging
- `adb logcat` during device testing
- Keep only 3 most recent APKs in root directory (~250MB each)
- Java: `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64`

### Don't reinvent each session
This whole section exists because Eric kept re-explaining it. If you're tempted
to suggest `eas update`, stop — it's not wired and won't work without
`expo-updates` + `runtimeVersion` setup (deliberately not configured).

## Git
Commit locally as needed. Only push when explicitly asked.
