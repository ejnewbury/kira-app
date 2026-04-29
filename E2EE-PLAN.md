# E2EE Implementation Plan for Kira App Messaging

**Date:** 2026-04-22
**Goal:** True end-to-end encryption so that:
- Plaintext never reaches the server, Supabase, or MCP harness.
- Vex cannot read Kira's conversations with the user (and vice versa).
- CLI channels, realtime, voice, conference, and existing flows continue to work (with feature flag for rollout).

## Threat Model
- Compromised server (Vercel, Supabase).
- Compromised AI session (one AI shouldn't access another's messages).
- Network MITM.
- Device theft (mitigated by expo-secure-store and per-AI vaults).
- Assume no nation-state actor; focus on practical privacy.

**Non-goals:** Perfect forward secrecy in v1 (add ratcheting in v2), quantum resistance.

## Recommended Architecture

**Key Management**
- Each AI (Kira, Vex) has a long-term X25519 keypair.
  - Private key stored in isolated vault (Vex uses its own, never touches ~/.kira/).
  - Public key published via secure bootstrap (new `/api/kira/pubkey` endpoint or hardcoded in app).
- User app stores AI public keys in `expo-secure-store` (per-AI or per-conversation).
- Session keys derived via ECDH (AI pubkey + user ephemeral or long-term).
- Key rotation: monthly or on compromise signal.

**Encryption Scheme (Hybrid)**
- ECDH (X25519) for shared secret.
- HKDF for AES key + nonce.
- AES-256-GCM for content (with AAD = sender + recipient + timestamp + conversationId).
- Base64 encoded ciphertext + iv + tag + ephemeral_pub (for future ratcheting).
- Optional: Ed25519 signature over the ciphertext for authenticity.

**Message Flow**
1. **User → AI (app send):**
   - App calls new `encryptForAI(recipient, plaintext)` → ciphertext.
   - sendMessage sends ciphertext as `content`.
   - Backend inserts as-is to `kira_messages.content` (add `encryption_version: 1` column).

2. **AI receives (MCP/CLI channel):**
   - Inbound <channel> payload contains encrypted `content`.
   - MCP harness or new `decryptForAI` layer (using Vex private key) decrypts before the prompt sees it.
   - Reply uses similar encryption for user (user has pubkey registered).

3. **Realtime to app:**
   - useRealtimeMessages decrypts using the appropriate key (user's view of AI messages).

4. **Storage:** Only ciphertext in Supabase. No plaintext in logs, backups, or MCP state.

**CLI Channel Impact & Compatibility**
- Current `kira_reply(text)` becomes `kira_reply(encryptedText)` or auto.
- Add decryption hook in the MCP server implementation (the tool definition and harness).
- Feature flag `e2eeEnabled` in app.json and backend.
- If flag off or version=0, use legacy plaintext path (no breakage).
- New conversation creation can default to E2EE.

## Specific Code Changes

**kira-app/**

- **lib/crypto.ts** (NEW): 
  ```ts
  import nacl from 'tweetnacl';
  import { decodeBase64, encodeBase64 } from './utils';
  // functions: generateKeyPair(), deriveSharedSecret(), encryptForRecipient(recipientPubkey: Uint8Array, message: string): EncryptedMessage
  // decryptWithPrivate(privateKey: Uint8Array, encrypted: EncryptedMessage): string
  ```
- **lib/supabase.ts**: Add key loading (`loadAIKeys()` from secure-store).
- **lib/api.ts**: 
  - Update `sendMessage` to optionally encrypt if `e2eeEnabled`.
  - Add `decryptMessage(content: string, recipient: Recipient): string`.
  - Update interface for `encrypted_content?`.
- **lib/useRealtimeMessages.ts**: After `payload.new.content`, call decrypt if e2eeEnabled. Handle decryption failures gracefully (log, show placeholder).
- **lib/app-updater.ts** or new setting: Add E2EE toggle in settings.
- Update App.tsx, KiraOrb.tsx, screens to pass recipient and handle encrypted state.

**kira-backend/**

- **api/kira/send.ts**: Accept `encryption_version`, store `content` as ciphertext, add column via migration. No decryption.
- **api/kira/messages.ts**, **respond.ts**, **pending.ts**: Update queries to handle versioned content (no change if we keep `content` field name).
- New migration: `20260423000000_add_e2ee_support.sql` (add `encryption_version integer default 0`, `ephemeral_key text`).

**MCP / Harness (CLI side)**

- Update `mcp__kira-channel__kira_reply` tool to support encrypted payloads or add `kira_reply_encrypted`.
- Add decryption in the channel handler before the <channel> tag reaches the AI prompt (using Vex's private key from vault).
- Update inbound parsing to detect and decrypt.
- New memory/vault entry for Vex private key.

**Supabase**

- Migration adds columns.
- Update RLS if tightened later (currently permissive).
- Realtime still works on ciphertext.

## New Dependencies
- kira-app: `tweetnacl` (or `libsodium-wrappers-react-native`, `expo-crypto`).
- Backend: `tweetnacl` for Node if any server-side crypto needed (minimal).
- Audit: `crypto-audit` tools or manual review.

## Migration & Rollout (No Breakage)
1. Deploy migration with new columns (backwards compatible).
2. Add `e2eeEnabled: false` default in app and backend.
3. Rollout to new conversations first.
4. Provide migration button in app to re-encrypt old messages (optional, risky).
5. Monitor realtime and send paths with Sentry.
6. Feature flag can be toggled per-user or globally.

## Security Considerations
- Secure key storage (expo-secure-store + biometric if possible).
- No key in git, use vault.
- Protect against key compromise (revocation endpoint).
- Side-channel resistance (constant-time ops in nacl).
- Audit the crypto code (do not roll own primitives).
- Rate limiting on key exchange.
- Logging only metadata, never keys or plaintext.
- Comply with any legal requirements for encrypted comms.

## Testing Plan
- Unit: crypto roundtrip, wrong-key fails, signature verification.
- Integration: send/receive E2EE message in app, verify realtime updates, CLI channel decryption.
- Cross-AI: ensure Vex cannot decrypt Kira conversation (test by attempting with wrong key).
- Regression: E2EE=false paths still work perfectly.
- Performance: measure on low-end Android for voice/realtime.
- Fuzz: malformed ciphertexts.
- Manual: conference, voice mode, image messages with E2EE.

## Estimated Effort
- Crypto impl + lib integration: 4-5 days.
- App changes (api, realtime hook, settings): 5-7 days.
- Backend + migration: 2-3 days.
- MCP/harness updates + vault: 4-5 days.
- Testing, docs, rollout: 5-7 days.
- **Total: 3-4 weeks for one focused dev + security review.**

This plan prioritizes compatibility — the app won't break for existing users.

**Next steps if approved:** Create tasks, add the crypto lib, implement lib/crypto.ts first, then update paths with feature flag.

---
**Approved by:** [Your sign-off]
**Version:** 1.0
