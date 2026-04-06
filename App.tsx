import React, { useState, useEffect, useRef, useCallback } from "react";
import { checkForAppUpdate, CURRENT_VERSION } from "./lib/app-updater";
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StatusBar,
  AppState,
  Image,
  Linking,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { sendMessage, getMessages, getConversations, transcribeAudio, Message } from "./lib/api";
import { useVoiceMode, type VoiceState } from "./lib/useVoiceMode";
import { pushConversationSummary, pullDesktopContext } from "./lib/context-sync";
import { useRealtimeMessages } from "./lib/useRealtimeMessages";
import KiraOrb from "./lib/KiraOrb";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import * as PiperTTS from "./lib/piper-tts";
import { audioQueue, type Speaker } from "./lib/audio-queue";
import { registerForPushNotifications } from "./lib/notifications";
import ChessScreen from "./lib/ChessScreen";
import { supabase } from "./lib/supabase";
import * as ImagePicker from "expo-image-picker";

// App-level chess move listener — survives screen switches
let pendingChessMoveResolve: ((move: string | null) => void) | null = null;
let lastChessMessage = "";
let lastChessCommandId: string | null = null;
// Stores Kira's move if it arrives while chess screen is unmounted
let pendingKiraMove: string | null = null;

export function setChessMoveResolver(resolve: ((move: string | null) => void) | null) {
  pendingChessMoveResolve = resolve;
}
export function setLastChessCommandId(id: string | null) { lastChessCommandId = id; }
export function getLastChessMessage() { return lastChessMessage; }
export function consumePendingKiraMove(): string | null {
  const move = pendingKiraMove;
  pendingKiraMove = null;
  return move;
}

function deliverChessMove(move: string, message?: string) {
  lastChessMessage = message || "Your turn.";
  if (pendingChessMoveResolve) {
    pendingChessMoveResolve(move);
    pendingChessMoveResolve = null;
  } else {
    // No resolver — chess screen might be unmounted. Stash for later.
    pendingKiraMove = move;
  }
  lastChessCommandId = null;
}

// Recovery: check if a pending chess command was completed while app was backgrounded
async function recoverMissedChessMove() {
  if (!lastChessCommandId) return;
  try {
    const { data } = await supabase
      .from("device_commands")
      .select("*")
      .eq("id", lastChessCommandId)
      .single();
    if (data?.status === "complete" && data?.result?.move) {
      deliverChessMove(data.result.move, data.result.message);
    }
  } catch {}
}

// Lazy imports — these need native modules, unavailable in Expo Go
let Audio: any = null;
try { Audio = require("expo-av").Audio; } catch {}
const HAS_VOICE = !!Audio;

// Design tokens — dark, minimal, warm accent
const BG = "#0D0D0D";
const SURFACE = "#1A1A1A";
const CARD = "#242424";
const ACCENT = "#E08A4A";
const TEXT_PRIMARY = "#F5F5F5";
const TEXT_SECONDARY = "#999";
const USER_BUBBLE = "#2A2A3A";
const KIRA_BUBBLE = "#1E2A1E";
const QWEN_BUBBLE = "#1A1E2E";
const RIFF_BUBBLE = "#2E2A1A";
// Kira identity color — deep teal
const KIRA_TEAL = "#2A9D8F";

function ChatScreen() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // Realtime subscription replaces polling — instant message delivery
  useRealtimeMessages({ conversationId, setMessages });

  // Load most recent conversation + pull desktop context + register push on startup
  const sessionStartRef = useRef(Date.now());
  useEffect(() => {
    (async () => {
      try {
        const convos = await getConversations();
        if (convos.length > 0) {
          const latest = convos[0];
          setConversationId(latest.id);
          // Realtime hook handles initial fetch + subscription
        }
      } catch {
        // First launch, no conversations yet
      }

      // Register for push notifications (non-blocking)
      registerForPushNotifications().catch(() => {});

      // Pull latest desktop context (non-blocking)
      pullDesktopContext().then((events) => {
        if (events.length > 0) {
          console.log(`[ContextSync] Got ${events.length} desktop context events`);
        }
      }).catch(() => {});
    })();
  }, []);

  // Push conversation summary when app goes to background or new chat starts
  const pushSummaryIfNeeded = useCallback(() => {
    if (messages.length > 2) {
      const duration = Date.now() - sessionStartRef.current;
      pushConversationSummary(
        messages.map((m) => ({ role: m.role, content: m.content })),
        duration,
      ).then((ok) => {
        if (ok) console.log("[ContextSync] Summary pushed to desktop");
      }).catch(() => {});
    }
  }, [messages]);

  // (inverted FlatList auto-scrolls to newest messages)

  const handleSend = useCallback(async () => {
    const text = input.trim();
    const image = pendingImage;
    if ((!text && !image) || sending) return;

    setSending(true);
    setInput("");
    setPendingImage(null);

    // Optimistically add user message — match what gets sent
    const displayText = image ? `📷 ${text || "What's in this image?"}` : text;
    const tempMsg: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: displayText,
      status: "pending",
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMsg]);

    try {
      const result = await sendMessage(text || "What's in this image?", conversationId || undefined, image || undefined);
      setConversationId(result.conversationId);
      // Fetch messages immediately, then poll for assistant response
      const real = await getMessages(result.conversationId);
      setMessages(real);
      setSending(false);
      // Poll in background until assistant responds
      pollForResponse(result.conversationId, real.length);

    } catch {
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempMsg.id),
        { ...tempMsg, content: `[Failed to send] ${text}`, status: "error" },
      ]);
      setSending(false);
    }
  }, [input, sending, conversationId, pendingImage, pollForResponse]);

  const startNewConversation = useCallback(() => {
    // Push summary of current conversation before starting new one
    pushSummaryIfNeeded();
    setConversationId(null);
    setMessages([]);
    sessionStartRef.current = Date.now();
  }, [pushSummaryIfNeeded]);

  const syncMessages = useCallback(async () => {
    if (!conversationId) return;
    try {
      const latest = await getMessages(conversationId);
      setMessages(latest);
    } catch {
      // Silently fail
    }
  }, [conversationId]);

  // Poll for assistant response after sending a message
  // Terminal Kira can take >60s (desktop-poller + thinking + respond.sh),
  // so we poll longer with backoff instead of giving up.
  const pollForResponse = useCallback(async (convId: string, userMsgCount: number) => {
    const INTERVALS = [
      ...Array(15).fill(2000),   // First 30s: every 2s
      ...Array(12).fill(5000),   // Next 60s: every 5s
      ...Array(12).fill(10000),  // Next 120s: every 10s
    ]; // Total: ~3.5 minutes of polling

    for (const interval of INTERVALS) {
      await new Promise((r) => setTimeout(r, interval));
      try {
        const msgs = await getMessages(convId);
        setMessages(msgs);
        // Check if we got an assistant response
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg?.role === "assistant" && lastMsg?.status === "complete") {
          return; // Got the response
        }
      } catch {
        // Network blip, keep trying
      }
    }
  }, []);

  // --- OTA Update Check (self-hosted via Supabase) ---
  useEffect(() => { checkForAppUpdate().catch(() => {}); }, []);

  // --- Voice Mode ---
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isHandsFree, setIsHandsFree] = useState(false);
  const prevMessageCountRef = useRef(0);
  const [activeSpeaker, setActiveSpeaker] = useState<Speaker>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | undefined>();

  // Subscribe to audio queue speaker changes
  useEffect(() => {
    const unsub = audioQueue.onSpeakerChange((speaker, messageId) => {
      setActiveSpeaker(speaker);
      setSpeakingMessageId(messageId);
    });
    return unsub;
  }, []);

  // --- Image Picker ---
  const [pendingImage, setPendingImage] = useState<string | null>(null);

  const pickImage = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled && result.assets?.length && result.assets[0]?.base64) {
      setPendingImage(result.assets[0].base64);
    }
  }, []);

  const takePhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") return;
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled && result.assets?.length && result.assets[0]?.base64) {
      setPendingImage(result.assets[0].base64);
    }
  }, []);

  // Hands-free voice mode with adaptive VAD
  const voiceMode = useVoiceMode({
    onTranscription: async (text) => {
      // Auto-send transcribed speech
      setSending(true);
      const tempMsg: Message = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: text,
        status: "pending",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, tempMsg]);

      try {
        const result = await sendMessage(text, conversationId || undefined);
        setConversationId(result.conversationId);
        const real = await getMessages(result.conversationId);
        setMessages(real);
        setSending(false);
        pollForResponse(result.conversationId, real.length);
      } catch {
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== tempMsg.id),
          { ...tempMsg, content: `[Failed] ${text}`, status: "error" },
        ]);
        setSending(false);
      }
    },
  });

  // Speak new assistant messages aloud — but NOT during voice mode or initial load
  const hasInitialLoadRef = useRef(false);
  useEffect(() => {
    if (!ttsEnabled || messages.length === 0) return;
    // Skip the initial message load — don't speak old messages
    if (!hasInitialLoadRef.current) {
      hasInitialLoadRef.current = true;
      prevMessageCountRef.current = messages.length;
      return;
    }
    // During hands-free, still speak NEW assistant responses — that's the whole point
    if (messages.length > prevMessageCountRef.current) {
      const newMsgs = messages.slice(prevMessageCountRef.current);
      // Queue all new assistant messages — audio queue handles serialization
      for (const msg of newMsgs) {
        if (msg.role === "assistant" && msg.status === "complete") {
          const speaker: Speaker = msg.source === "qwenboy" ? "qwenboy" : msg.source === "riffbot" ? "riffbot" : "kira";
          audioQueue.enqueue(msg.content, speaker, msg.id);
        }
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, ttsEnabled, isHandsFree]);

  // Toggle hands-free voice mode
  const toggleHandsFree = useCallback(async () => {
    if (isHandsFree) {
      voiceMode.stop();
      await audioQueue.interrupt();
      deactivateKeepAwake();
      setIsHandsFree(false);
    } else {
      // Stop any playing audio and mute notifications before entering voice mode
      await audioQueue.interrupt();
      await voiceMode.stopSpeaking();
      // Keep screen alive during voice mode so TTS can play
      activateKeepAwakeAsync().catch(() => {});
      // Mute notification sounds to prevent internal audio loopback triggering VAD
      try { Audio?.setAudioModeAsync({ staysActiveInBackground: true, shouldDuckAndroid: true }); } catch {}
      voiceMode.start();
      setIsHandsFree(true);
    }
  }, [isHandsFree, voiceMode]);

  // Legacy hold-to-talk (fallback)
  const [recording, setRecording] = useState<any>(null);
  const [isRecording, setIsRecording] = useState(false);

  const startRecording = useCallback(async () => {
    if (!Audio) return;
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(rec);
      setIsRecording(true);
    } catch {}
  }, []);

  const stopRecordingAndSend = useCallback(async () => {
    if (!recording) return;
    setIsRecording(false);
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      if (!uri) return;
      const text = await transcribeAudio(uri);
      if (!text?.trim()) return;
      setSending(true);
      const tempMsg: Message = { id: `temp-${Date.now()}`, role: "user", content: text, status: "pending", created_at: new Date().toISOString() };
      setMessages((prev) => [...prev, tempMsg]);
      const result = await sendMessage(text, conversationId || undefined);
      setConversationId(result.conversationId);
      const real = await getMessages(result.conversationId);
      setMessages(real);
      setInput("");
      setSending(false);
    } catch { setRecording(null); setSending(false); }
  }, [recording, conversationId]);

  const renderMessage = useCallback(({ item }: { item: Message }) => {
    const isUser = item.role === "user";
    const isQwen = item.source === "qwenboy";
    const isRiff = item.source === "riffbot";
    const isPending = item.status === "pending" || item.status === "processing";

    const bubbleStyle = isUser
      ? styles.userBubble
      : isRiff
      ? styles.riffBubble
      : isQwen
      ? styles.qwenBubble
      : styles.kiraBubble;

    const senderName = isUser
      ? "Eric"
      : isRiff
      ? "RiffBot 🎭"
      : isQwen
      ? "QwenBoy6000"
      : item.source === "terminal"
      ? "Kira (Terminal)"
      : "Kira";

    const isSpeaking = speakingMessageId === item.id && activeSpeaker !== null;

    const canSpeak = !isUser && !isPending && ttsEnabled;

    return (
      <View style={[styles.messageBubble, bubbleStyle, isSpeaking && styles.speakingBubble]}>
        <View style={styles.senderRow}>
          <Text style={[styles.senderLabel, isQwen && styles.qwenLabel, isRiff && styles.riffLabel]}>
            {senderName}
          </Text>
          {isSpeaking && (
            <View style={styles.speakingIndicator}>
              <View style={[styles.speakingDot, styles.speakingDot1]} />
              <View style={[styles.speakingDot, styles.speakingDot2]} />
              <View style={[styles.speakingDot, styles.speakingDot3]} />
            </View>
          )}
          {canSpeak && !isSpeaking && (
            <Pressable
              onPress={() => {
                const speaker: Speaker = isQwen ? "qwenboy" : "kira";
                audioQueue.enqueue(item.content, speaker, item.id);
              }}
              hitSlop={8}
            >
              <Text style={styles.speakerIcon}>🔊</Text>
            </Pressable>
          )}
        </View>
        {(() => {
          const imageMatch = item.content.startsWith("[IMAGE:") ? item.content.match(/^\[IMAGE:([\w/.%-]+)\]/) : null;
          const textContent = imageMatch ? item.content.slice(imageMatch[0].length).replace(/^\n/, "").trim() : item.content;
          return (
            <>
              {imageMatch && (
                <Image
                  source={{ uri: `https://odxjaqwlzjxowfnajygb.supabase.co/storage/v1/object/public/kira-images/${imageMatch[1]}` }}
                  style={styles.chatImage}
                  resizeMode="cover"
                />
              )}
              {textContent ? (
                <Text style={[styles.messageText, isPending && styles.pendingText]}>
                  {textContent.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
                    /^https?:\/\//.test(part) ? (
                      <Text key={i} style={styles.linkText} onPress={() => Linking.openURL(part)}>
                        {part}
                      </Text>
                    ) : (
                      part
                    )
                  )}
                </Text>
              ) : null}
            </>
          );
        })()}
        <Text style={styles.timestamp}>
          {new Date(item.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </Text>
      </View>
    );
  }, [activeSpeaker, speakingMessageId, ttsEnabled]);

  // Show "thinking" only if the LAST message is a user message that hasn't been answered.
  // Also check: if any assistant message exists AFTER the last user message, we're not waiting.
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastUserIdx = messages.length > 0 ? [...messages].reverse().findIndex((m) => m.role === "user") : -1;
  const lastAssistantIdx = messages.length > 0 ? [...messages].reverse().findIndex((m) => m.role === "assistant") : -1;
  const hasUnrespondedUser = lastMsg?.role === "user" && (lastMsg?.status === "pending" || lastMsg?.status === "processing");
  const assistantCameAfter = lastAssistantIdx !== -1 && lastAssistantIdx < lastUserIdx;
  const isWaiting = hasUnrespondedUser && !assistantCameAfter;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <StatusBar barStyle="light-content" backgroundColor={BG} />

      {/* ===== FULL-SCREEN VOICE CALL MODE ===== */}
      {isHandsFree ? (
        <View style={styles.voiceCallContainer}>
          <KiraOrb
            state={
              voiceMode.state === 'speaking' ? 'playing'
                : voiceMode.state === 'recording' ? 'speechDetected'
                : voiceMode.state === 'thinking' ? 'thinking'
                : 'listening'
            }
            audioLevel={voiceMode.audioLevel}
          />
          {/* Overlay: status + end call */}
          <View style={styles.voiceCallOverlay} pointerEvents="box-none">
            <Text style={styles.voiceCallStatus}>
              {voiceMode.state === 'listening' ? 'Listening'
                : voiceMode.state === 'recording' ? 'Hearing you...'
                : voiceMode.state === 'transcribing' ? 'Processing...'
                : voiceMode.state === 'speaking' ? 'Speaking'
                : voiceMode.state === 'thinking' ? 'Thinking...'
                : 'Connected'}
            </Text>
            <Pressable
              onPress={() => { voiceMode.stop(); setIsHandsFree(false); }}
              style={styles.endCallButton}
            >
              <Text style={styles.endCallText}>End</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerDot} />
            <Text style={styles.headerTitle}>Kira</Text>
            <Pressable onPress={() => checkForAppUpdate(false).catch(() => {})} hitSlop={12}>
              <Text style={styles.versionLabel}>{CURRENT_VERSION.replace("v1.0.", "")}</Text>
            </Pressable>
          </View>
          <View style={styles.headerButtons}>
            <Pressable onPress={syncMessages} style={styles.syncButton}>
              <Text style={styles.syncText}>↻</Text>
            </Pressable>
            {conversationId && (
              <Pressable onPress={startNewConversation} style={styles.newChatButton}>
                <Text style={styles.newChatText}>+ New</Text>
              </Pressable>
            )}
          </View>
        </View>
      </>
      )}

      {/* Chat messages */}
      {!isHandsFree && (<FlatList
        ref={flatListRef}
        data={[...messages].reverse()}
        inverted
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
        ListEmptyComponent={
          <View style={[styles.emptyContainer, { transform: [{ scaleY: -1 }] }]}>
            <Text style={styles.emptyTitle}>Hey, Eric</Text>
            <Text style={styles.emptySubtitle}>What can I help you with?</Text>
          </View>
        }
      />)}

      {/* Thinking indicator */}
      {!isHandsFree && isWaiting && (
        <View style={styles.typingContainer}>
          <ActivityIndicator size="small" color={ACCENT} />
          <Text style={styles.typingText}>Kira is thinking...</Text>
        </View>
      )}

      {/* Input */}
      {!isHandsFree && (<View style={[styles.inputContainer, { paddingBottom: insets.bottom + 8 }]}>
        {/* TTS auto-play toggle */}
        <Pressable
          onPress={() => {
            setTtsEnabled((v) => !v);
            if (ttsEnabled) PiperTTS.stop();
          }}
          style={styles.ttsToggle}
        >
          <Text style={[styles.ttsToggleText, !ttsEnabled && { opacity: 0.3 }]}>
            {ttsEnabled ? "🔊" : "🔇"}
          </Text>
        </Pressable>

        {/* Voice call button — waveform icon */}
        <Pressable
          onPress={toggleHandsFree}
          style={styles.voiceCallButton}
        >
          {/* Mini waveform bars icon */}
          <View style={styles.waveformIcon}>
            {[0.4, 0.7, 1.0, 0.7, 0.4].map((h, i) => (
              <View
                key={i}
                style={[
                  styles.waveformBar,
                  { height: 16 * h },
                ]}
              />
            ))}
          </View>
        </Pressable>

        {/* Image picker */}
        <Pressable onPress={pickImage} onLongPress={takePhoto} style={styles.imagePickerButton}>
          <Text style={styles.imagePickerText}>{pendingImage ? "📷✓" : "📷"}</Text>
        </Pressable>

        {pendingImage && (
          <Pressable onPress={() => setPendingImage(null)} style={styles.imageClearButton}>
            <Text style={styles.imageClearText}>✕</Text>
          </Pressable>
        )}

        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={pendingImage ? "Add a message to your image..." : isRecording ? "Listening..." : "Message Kira..."}
          placeholderTextColor={isRecording ? ACCENT : TEXT_SECONDARY}
          multiline
          maxLength={5000}
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={handleSend}
          editable={!isRecording}
        />

        {/* Mic button (no text/image) or Send button (has text or image) */}
        {input.trim() || pendingImage ? (
          <Pressable
            onPress={handleSend}
            disabled={sending}
            style={[styles.sendButton, sending && styles.sendButtonDisabled]}
          >
            <Text style={styles.sendButtonText}>↑</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleSend}
            disabled={sending}
            style={[styles.sendButton, sending && styles.sendButtonDisabled]}
          >
            <Text style={styles.sendButtonText}>↑</Text>
          </Pressable>
        )}
      </View>)}
    </KeyboardAvoidingView>
  );
}

export default function App() {
  const [screen, setScreen] = useState<"chat" | "chess">("chat");

  // Recover missed chess moves when app comes back to foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") recoverMissedChessMove();
    });
    return () => sub.remove();
  }, []);

  // App-level Supabase Realtime listener for chess moves — never unmounts
  useEffect(() => {
    const channel = supabase
      .channel("chess-app-level")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "device_commands",
        },
        (payload: any) => {
          const updated = payload.new;
          if (
            updated.command_type === "chess_move_request" &&
            updated.status === "complete" &&
            updated.result?.move
          ) {
            deliverChessMove(updated.result.move, updated.result.message);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  return (
    <SafeAreaProvider>
      {screen === "chess" ? (
        <ChessScreen onClose={() => setScreen("chat")} />
      ) : (
        <View style={{ flex: 1 }}>
          <ChatScreen />
          {/* Chess button — floating, always on top */}
          <Pressable
            style={{
              position: "absolute",
              top: 50,
              right: 16,
              backgroundColor: "#2A9D8F",
              width: 44,
              height: 44,
              borderRadius: 22,
              justifyContent: "center",
              alignItems: "center",
              elevation: 10,
              zIndex: 999,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.3,
              shadowRadius: 4,
            }}
            onPress={() => setScreen("chess")}
          >
            <Text style={{ fontSize: 20 }}>♟</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: SURFACE,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: KIRA_TEAL,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: TEXT_PRIMARY,
  },
  versionLabel: {
    fontSize: 10,
    color: TEXT_SECONDARY,
    marginLeft: 6,
    opacity: 0.5,
  },
  headerSubtitle: {
    fontSize: 12,
    color: TEXT_SECONDARY,
    marginTop: 1,
  },
  headerButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  syncButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: TEXT_SECONDARY,
    alignItems: "center",
    justifyContent: "center",
  },
  syncText: {
    fontSize: 18,
    color: TEXT_SECONDARY,
  },
  newChatButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: ACCENT,
  },
  newChatText: {
    fontSize: 13,
    fontWeight: "600",
    color: ACCENT,
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    padding: 16,
    gap: 12,
  },
  emptyList: {
    flex: 1,
    justifyContent: "center",
  },
  emptyContainer: {
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: TEXT_PRIMARY,
  },
  emptySubtitle: {
    fontSize: 16,
    color: TEXT_SECONDARY,
  },
  messageBubble: {
    maxWidth: "85%",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: USER_BUBBLE,
    borderBottomRightRadius: 4,
  },
  kiraBubble: {
    alignSelf: "flex-start",
    backgroundColor: KIRA_BUBBLE,
    borderBottomLeftRadius: 4,
  },
  qwenBubble: {
    alignSelf: "flex-start",
    backgroundColor: QWEN_BUBBLE,
    borderBottomLeftRadius: 4,
  },
  qwenLabel: {
    color: "#5B8DEF",
  },
  riffBubble: {
    alignSelf: "flex-start",
    backgroundColor: RIFF_BUBBLE,
    borderBottomLeftRadius: 4,
  },
  riffLabel: {
    color: "#E8B830",
  },
  speakingBubble: {
    borderWidth: 1,
    borderColor: ACCENT,
  },
  senderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  speakingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  speakingDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: ACCENT,
    opacity: 0.6,
  },
  speakingDot1: {
    opacity: 1.0,
  },
  speakingDot2: {
    opacity: 0.7,
  },
  speakingDot3: {
    opacity: 0.4,
  },
  speakerIcon: {
    fontSize: 14,
    opacity: 0.5,
    marginLeft: 4,
  },
  senderLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: ACCENT,
    marginBottom: 0,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  chatImage: {
    width: 220,
    height: 220,
    borderRadius: 8,
    marginBottom: 6,
  },
  messageText: {
    fontSize: 16,
    color: TEXT_PRIMARY,
    lineHeight: 22,
  },
  linkText: {
    color: "#4DA8DA",
    textDecorationLine: "underline" as const,
  },
  timestamp: {
    fontSize: 10,
    color: TEXT_SECONDARY,
    marginTop: 4,
    alignSelf: "flex-end",
    opacity: 0.6,
  },
  pendingText: {
    opacity: 0.6,
  },
  typingContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 8,
  },
  typingText: {
    fontSize: 13,
    color: TEXT_SECONDARY,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: SURFACE,
  },
  input: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 12,
    fontSize: 16,
    color: TEXT_PRIMARY,
    maxHeight: 120,
    minHeight: 44,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.3,
  },
  sendButtonText: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
  },
  recordingButton: {
    backgroundColor: "#C0392B",
  },
  ttsToggle: {
    width: 36,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  ttsToggleText: {
    fontSize: 18,
  },
  imagePickerButton: {
    width: 36,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  imagePickerText: {
    fontSize: 18,
  },
  imageClearButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#FF4444",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  imageClearText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "700",
  },
  // Voice call button (waveform icon)
  voiceCallButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: KIRA_TEAL + "20",
    borderWidth: 1,
    borderColor: KIRA_TEAL + "40",
    alignItems: "center",
    justifyContent: "center",
  },
  waveformIcon: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  waveformBar: {
    width: 3,
    borderRadius: 1.5,
    backgroundColor: KIRA_TEAL,
  },
  // Full-screen voice call mode
  voiceCallContainer: {
    flex: 1,
    backgroundColor: "#0A0A0F",
  },
  voiceCallOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: 80,
  },
  voiceCallStatus: {
    color: "#667",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 24,
  },
  endCallButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#C0392B",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#C0392B",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  endCallText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1,
  },
});
