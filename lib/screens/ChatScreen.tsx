/**
 * ChatScreen — Clean messaging screen.
 * Extracted from App.tsx monolith.
 * Mirror's Edge "Urban Pulse" aesthetic.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, TextInput, FlatList, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, StatusBar,
  Image, Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sendMessage, getMessages, getConversations, transcribeAudio, getTerminalStatus, Message } from "../api";
import { useVoiceMode, type VoiceState } from "../useVoiceMode";
import { pushConversationSummary, pullDesktopContext } from "../context-sync";
import { useRealtimeMessages } from "../useRealtimeMessages";
import KiraOrb from "../KiraOrb";
import { checkForAppUpdate, CURRENT_VERSION } from "../app-updater";
let activateKeepAwakeAsync: any, deactivateKeepAwake: any;
try {
  const mod = require("expo-keep-awake");
  activateKeepAwakeAsync = mod.activateKeepAwakeAsync;
  deactivateKeepAwake = mod.deactivateKeepAwake;
} catch {
  activateKeepAwakeAsync = () => Promise.resolve();
  deactivateKeepAwake = () => {};
}
import * as PiperTTS from "../piper-tts";
import { audioQueue, type Speaker } from "../audio-queue";
import { registerForPushNotifications } from "../notifications";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import { Colors, Typography, Spacing } from "../theme";

let Audio: any = null;
try { Audio = require("expo-av").Audio; } catch {}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [terminalOnline, setTerminalOnline] = useState<boolean | null>(null);
  const flatListRef = useRef<FlatList>(null);

  // Realtime subscription
  useRealtimeMessages({ conversationId, setMessages });

  // Load most recent conversation on startup
  const sessionStartRef = useRef(Date.now());
  useEffect(() => {
    (async () => {
      try {
        const convos = await getConversations();
        if (convos.length > 0) {
          setConversationId(convos[0].id);
        }
      } catch {}
      registerForPushNotifications().catch(() => {});
      pullDesktopContext().catch(() => {});
    })();
  }, []);

  // Poll terminal status
  useEffect(() => {
    const check = () => getTerminalStatus().then(s => setTerminalOnline(s.online)).catch(() => setTerminalOnline(false));
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  const pushSummaryIfNeeded = useCallback(() => {
    if (messages.length > 2) {
      pushConversationSummary(
        messages.map((m) => ({ role: m.role, content: m.content })),
        Date.now() - sessionStartRef.current,
      ).catch(() => {});
    }
  }, [messages]);

  const startNewConversation = useCallback(() => {
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
    } catch {}
  }, [conversationId]);

  // Poll for response with backoff
  const pollForResponse = useCallback(async (convId: string, userMsgCount: number) => {
    const INTERVALS = [
      ...Array(15).fill(2000),
      ...Array(12).fill(5000),
      ...Array(12).fill(10000),
    ];
    for (const interval of INTERVALS) {
      await new Promise((r) => setTimeout(r, interval));
      try {
        const msgs = await getMessages(convId);
        setMessages(msgs);
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg?.role === "assistant" && lastMsg?.status === "complete") return;
      } catch {}
    }
  }, []);

  // OTA check
  useEffect(() => { checkForAppUpdate().catch(() => {}); }, []);

  // --- Voice ---
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isHandsFree, setIsHandsFree] = useState(false);
  const prevMessageCountRef = useRef(0);
  const [activeSpeaker, setActiveSpeaker] = useState<Speaker>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | undefined>();

  useEffect(() => {
    const unsub = audioQueue.onSpeakerChange((speaker, messageId) => {
      setActiveSpeaker(speaker);
      setSpeakingMessageId(messageId);
    });
    return unsub;
  }, []);

  // --- Action tray ---
  const [showActions, setShowActions] = useState(false);

  // --- Image ---
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const pickImage = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, base64: true });
    if (!result.canceled && result.assets?.length && result.assets[0]?.base64) setPendingImage(result.assets[0].base64);
  }, []);
  const takePhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") return;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
    if (!result.canceled && result.assets?.length && result.assets[0]?.base64) setPendingImage(result.assets[0].base64);
  }, []);

  // Voice mode
  const voiceMode = useVoiceMode({
    onTranscription: async (text) => {
      setSending(true);
      const tempMsg: Message = { id: `temp-${Date.now()}`, role: "user", content: text, status: "pending", created_at: new Date().toISOString() };
      setMessages((prev) => [...prev, tempMsg]);
      try {
        const result = await sendMessage(text, conversationId || undefined);
        setConversationId(result.conversationId);
        const real = await getMessages(result.conversationId);
        setMessages(real);
        setSending(false);
        pollForResponse(result.conversationId, real.length);
      } catch {
        setMessages((prev) => [...prev.filter((m) => m.id !== tempMsg.id), { ...tempMsg, content: `[Failed] ${text}`, status: "error" }]);
        setSending(false);
      }
    },
  });

  // Auto-speak new assistant messages
  const hasInitialLoadRef = useRef(false);
  useEffect(() => {
    if (!ttsEnabled || messages.length === 0) return;
    if (!hasInitialLoadRef.current) {
      hasInitialLoadRef.current = true;
      prevMessageCountRef.current = messages.length;
      return;
    }
    if (messages.length > prevMessageCountRef.current) {
      const newMsgs = messages.slice(prevMessageCountRef.current);
      for (const msg of newMsgs) {
        if (msg.role === "assistant" && msg.status === "complete") {
          const speaker: Speaker = msg.source === "qwenboy" ? "qwenboy" : msg.source === "riffbot" ? "riffbot" : "kira";
          audioQueue.enqueue(msg.content, speaker, msg.id);
        }
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, ttsEnabled]);

  const toggleHandsFree = useCallback(async () => {
    if (isHandsFree) {
      voiceMode.stop();
      await audioQueue.interrupt();
      deactivateKeepAwake();
      setIsHandsFree(false);
    } else {
      await audioQueue.interrupt();
      await voiceMode.stopSpeaking();
      activateKeepAwakeAsync().catch(() => {});
      try { Audio?.setAudioModeAsync({ staysActiveInBackground: true, shouldDuckAndroid: true }); } catch {}
      voiceMode.start();
      setIsHandsFree(true);
    }
  }, [isHandsFree, voiceMode]);

  // Send message
  const sendingRef = useRef(false);
  const handleSend = useCallback(async () => {
    const text = input.trim();
    const image = pendingImage;
    if ((!text && !image) || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setInput("");
    setPendingImage(null);
    if (showActions) setShowActions(false);
    const displayText = image ? `📷 ${text || "What's in this image?"}` : text;
    const tempMsg: Message = { id: `temp-${Date.now()}`, role: "user", content: displayText, status: "pending", created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, tempMsg]);
    try {
      const result = await sendMessage(text || "What's in this image?", conversationId || undefined, image || undefined);
      setConversationId(result.conversationId);
      // Don't fetch messages here — Realtime listener handles dedup and will
      // replace the temp message with the real one. Fetching causes double-post.
      setSending(false);
      sendingRef.current = false;
    } catch {
      setMessages((prev) => [...prev.filter((m) => m.id !== tempMsg.id), { ...tempMsg, content: `[Failed to send] ${text}`, status: "error" }]);
      setSending(false);
      sendingRef.current = false;
    }
  }, [input, sending, conversationId, pendingImage, showActions]);

  // Render message bubble
  const renderMessage = useCallback(({ item }: { item: Message }) => {
    const isUser = item.role === "user";
    const isQwen = item.source === "qwenboy";
    const isRiff = item.source === "riffbot";
    const isPending = item.status === "pending" || item.status === "processing";
    const isSpeaking = speakingMessageId === item.id && activeSpeaker !== null;
    const canSpeak = !isUser && !isPending && ttsEnabled;

    const senderName = isUser ? "ERIC"
      : isRiff ? "RIFFBOT"
      : isQwen ? "QWENBOY"
      : item.source === "terminal" ? "KIRA · TERMINAL"
      : "KIRA";

    return (
      <View style={[
        styles.bubble,
        isUser ? styles.sentBubble : styles.receivedBubble,
        isQwen && styles.qwenBubble,
        isRiff && styles.riffBubble,
        isSpeaking && styles.speakingBubble,
      ]}>
        <View style={styles.senderRow}>
          <Text style={[
            styles.senderLabel,
            isUser && styles.sentLabel,
            isQwen && styles.qwenLabel,
            isRiff && styles.riffLabel,
          ]}>
            {senderName}
          </Text>
          {isSpeaking && (
            <View style={styles.speakingDots}>
              {[1, 0.7, 0.4].map((o, i) => (
                <View key={i} style={[styles.dot, { opacity: o }]} />
              ))}
            </View>
          )}
          {canSpeak && !isSpeaking && (
            <Pressable onPress={() => audioQueue.enqueue(item.content, isQwen ? "qwenboy" : "kira", item.id)} hitSlop={8}>
              <Text style={styles.speakerIcon}>▸</Text>
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
                <Pressable onLongPress={() => Clipboard.setStringAsync(textContent)} delayLongPress={400}>
                  <Text selectable style={[styles.messageText, isUser && styles.sentText, isPending && styles.pendingText]}>
                    {textContent.split(/(https?:\/\/[^\s]+|\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|[\w.-]+@[\w.-]+\.\w{2,})/g).map((part, i) =>
                      /^https?:\/\//.test(part) ? (
                        <Text key={i} style={styles.linkText} onPress={() => Linking.openURL(part)}>{part}</Text>
                      ) : /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(part) ? (
                        <Text key={i} style={styles.linkText} onPress={() => Linking.openURL(`tel:${part.replace(/[^\d+]/g, "")}`)}>{part}</Text>
                      ) : /[\w.-]+@[\w.-]+\.\w{2,}/.test(part) ? (
                        <Text key={i} style={styles.linkText} onPress={() => Linking.openURL(`mailto:${part}`)}>{part}</Text>
                      ) : part
                    )}
                  </Text>
                </Pressable>
              ) : null}
            </>
          );
        })()}
        <Text style={[styles.timestamp, isUser && styles.sentTimestamp]}>
          {new Date(item.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </Text>
      </View>
    );
  }, [activeSpeaker, speakingMessageId, ttsEnabled]);

  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const isWaiting = lastMsg?.role === "user" && (lastMsg?.status === "pending" || lastMsg?.status === "processing");

  return (
    <KeyboardAvoidingView style={[styles.container, { paddingTop: insets.top }]} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.bg} />

      {/* Voice call overlay */}
      {isHandsFree ? (
        <View style={styles.voiceContainer}>
          <KiraOrb
            state={
              voiceMode.state === "speaking" ? "playing"
                : voiceMode.state === "recording" ? "speechDetected"
                : voiceMode.state === "thinking" ? "thinking"
                : "listening"
            }
            audioLevel={voiceMode.audioLevel}
          />
          <View style={styles.voiceOverlay} pointerEvents="box-none">
            <Text style={styles.voiceStatus}>
              {voiceMode.state === "listening" ? "LISTENING"
                : voiceMode.state === "recording" ? "HEARING YOU"
                : voiceMode.state === "transcribing" ? "PROCESSING"
                : voiceMode.state === "speaking" ? "SPEAKING"
                : voiceMode.state === "thinking" ? "THINKING"
                : "CONNECTED"}
            </Text>
            <Pressable onPress={() => { voiceMode.stop(); setIsHandsFree(false); }} style={styles.endCallButton}>
              <Text style={styles.endCallText}>END</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>KIRA</Text>
            <View style={styles.headerRight}>
              <View style={[styles.statusDot, { backgroundColor: terminalOnline ? Colors.green : terminalOnline === false ? Colors.red : Colors.textFaint }]} />
              <Pressable onPress={syncMessages} hitSlop={12}>
                <Text style={styles.syncIcon}>↻</Text>
              </Pressable>
              {conversationId && (
                <Pressable onPress={startNewConversation} hitSlop={8}>
                  <Text style={styles.newChatLabel}>NEW</Text>
                </Pressable>
              )}
            </View>
          </View>
        </>
      )}

      {/* Messages */}
      {!isHandsFree && (
        <FlatList
          ref={flatListRef}
          data={[...messages].reverse()}
          inverted
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          style={styles.messageList}
          contentContainerStyle={styles.messageListContent}
          ListEmptyComponent={
            <View style={[styles.emptyContainer, { transform: [{ scaleY: -1 }] }]}>
              <Text style={styles.emptyTitle}>KIRA</Text>
              <Text style={styles.emptySubtext}>What can I help you with?</Text>
            </View>
          }
        />
      )}

      {/* Thinking */}
      {!isHandsFree && isWaiting && (
        <View style={styles.thinkingBar}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.thinkingText}>THINKING</Text>
        </View>
      )}

      {/* Input bar — floating pill with expandable actions */}
      {!isHandsFree && (
        <View style={[styles.inputOuter, { paddingBottom: insets.bottom + 12 }]}>
          {/* Expanded action tray — slides up above input */}
          {showActions && (
            <View style={styles.actionTray}>
              <Pressable onPress={() => { setTtsEnabled(v => !v); if (ttsEnabled) PiperTTS.stop(); }} style={styles.actionTrayItem}>
                <Text style={[styles.actionTrayIcon, !ttsEnabled && { opacity: 0.25 }]}>♫</Text>
                <Text style={styles.actionTrayLabel}>{ttsEnabled ? "TTS ON" : "TTS OFF"}</Text>
              </Pressable>
              <Pressable onPress={() => { setShowActions(false); toggleHandsFree(); }} style={styles.actionTrayItem}>
                <View style={styles.waveformIcon}>
                  {[0.4, 0.7, 1, 0.7, 0.4].map((h, i) => (
                    <View key={i} style={[styles.waveBar, { height: 14 * h }]} />
                  ))}
                </View>
                <Text style={styles.actionTrayLabel}>VOICE</Text>
              </Pressable>
              <Pressable onPress={() => Linking.openURL("tel:+19789042979")} style={styles.actionTrayItem}>
                <Text style={styles.actionTrayIcon}>☎</Text>
                <Text style={styles.actionTrayLabel}>CALL</Text>
              </Pressable>
              <Pressable onPress={() => { setShowActions(false); pickImage(); }} onLongPress={() => { setShowActions(false); takePhoto(); }} style={styles.actionTrayItem}>
                <Text style={styles.actionTrayIcon}>◻</Text>
                <Text style={styles.actionTrayLabel}>IMAGE</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.inputPill}>
            {/* Expand/collapse actions */}
            <Pressable onPress={() => setShowActions(v => !v)} style={styles.inputAction}>
              <Text style={[styles.inputActionText, showActions && { color: Colors.primary }]}>
                {showActions ? "✕" : "+"}
              </Text>
            </Pressable>

            {pendingImage && (
              <Pressable onPress={() => setPendingImage(null)} style={styles.imageClear}>
                <Text style={styles.imageClearText}>✕</Text>
              </Pressable>
            )}

            <TextInput
              style={styles.textInput}
              value={input}
              onChangeText={(t) => { setInput(t); if (showActions) setShowActions(false); }}
              placeholder={pendingImage ? "ADD A MESSAGE..." : "TRANSMIT MESSAGE..."}
              placeholderTextColor={Colors.textFaint}
              multiline
              maxLength={5000}
              returnKeyType="default"
              blurOnSubmit={false}
            />

            <Pressable onPress={handleSend} disabled={sending} style={[styles.sendButton, sending && { opacity: 0.3 }]}>
              <Text style={styles.sendIcon}>↑</Text>
            </Pressable>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPadding,
    paddingVertical: 14,
    backgroundColor: Colors.surfaceLow,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "100",
    letterSpacing: 10,
    color: Colors.primary,
    textTransform: "uppercase",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  statusDot: {
    width: 8,
    height: 8,
  },
  syncIcon: {
    fontSize: 18,
    color: Colors.textSecondary,
  },
  newChatLabel: {
    ...Typography.label,
    color: Colors.primary,
    fontSize: 9,
  },
  // Messages
  messageList: {
    flex: 1,
  },
  messageListContent: {
    padding: Spacing.screenPadding,
    gap: 16,
  },
  bubble: {
    maxWidth: "85%",
    padding: 16,
  },
  sentBubble: {
    alignSelf: "flex-end",
    backgroundColor: Colors.sentBubble,
  },
  receivedBubble: {
    alignSelf: "flex-start",
    backgroundColor: Colors.receivedBubble,
  },
  qwenBubble: {
    backgroundColor: Colors.qwenBubble,
  },
  riffBubble: {
    backgroundColor: Colors.riffBubble,
  },
  speakingBubble: {
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  senderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  senderLabel: {
    ...Typography.meta,
    color: Colors.textSecondary,
    letterSpacing: 3,
  },
  sentLabel: {
    color: "rgba(255,255,255,0.7)",
  },
  qwenLabel: {
    color: "#5B8DEF",
  },
  riffLabel: {
    color: "#E8B830",
  },
  speakingDots: {
    flexDirection: "row",
    gap: 2,
  },
  dot: {
    width: 4,
    height: 4,
    backgroundColor: Colors.primary,
  },
  speakerIcon: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  chatImage: {
    width: 220,
    height: 220,
    marginBottom: 6,
  },
  messageText: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 22,
  },
  sentText: {
    color: Colors.sentText,
  },
  linkText: {
    color: Colors.cyan,
  },
  pendingText: {
    opacity: 0.5,
  },
  timestamp: {
    ...Typography.meta,
    marginTop: 6,
    alignSelf: "flex-end",
  },
  sentTimestamp: {
    color: "rgba(255,255,255,0.5)",
  },
  // Empty state
  emptyContainer: {
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: "100",
    letterSpacing: 14,
    color: Colors.primary,
  },
  emptySubtext: {
    ...Typography.label,
    color: Colors.textFaint,
  },
  // Thinking
  thinkingBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPadding,
    paddingVertical: 8,
    gap: 8,
  },
  thinkingText: {
    ...Typography.label,
    color: Colors.textSecondary,
  },
  // Input pill
  inputOuter: {
    paddingHorizontal: Spacing.screenPadding,
    paddingTop: 8,
  },
  inputPill: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.surfaceHigh,
    borderRadius: 28,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  inputAction: {
    width: 36,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  inputActionText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  voiceButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary + "15",
    alignItems: "center",
    justifyContent: "center",
  },
  waveformIcon: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  waveBar: {
    width: 2,
    backgroundColor: Colors.primary,
  },
  imageClear: {
    width: 18,
    height: 18,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  imageClearText: {
    color: Colors.white,
    fontSize: 10,
    fontWeight: "700",
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "400",
    color: Colors.text,
    maxHeight: 100,
    minHeight: 36,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendIcon: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.white,
  },
  // Voice mode
  voiceContainer: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  voiceOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: 80,
  },
  voiceStatus: {
    ...Typography.label,
    color: Colors.textSecondary,
    fontSize: 11,
    marginBottom: 24,
  },
  endCallButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  endCallText: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 2,
  },
  // Action tray (expanded from + button)
  actionTray: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginBottom: 8,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.surfaceHigh,
    borderRadius: 16,
  },
  actionTrayItem: {
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionTrayIcon: {
    fontSize: 20,
    color: Colors.textSecondary,
  },
  actionTrayLabel: {
    ...Typography.meta,
    fontSize: 7,
    letterSpacing: 2,
  },
});
