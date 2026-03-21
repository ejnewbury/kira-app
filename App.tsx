import React, { useState, useEffect, useRef, useCallback } from "react";
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
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Audio } from "expo-av";
import * as Speech from "expo-speech";
import { sendMessage, getMessages, getConversations, transcribeAudio, Message } from "./lib/api";

// Design tokens — dark, minimal, warm accent
const BG = "#0D0D0D";
const SURFACE = "#1A1A1A";
const CARD = "#242424";
const ACCENT = "#E08A4A";
const TEXT_PRIMARY = "#F5F5F5";
const TEXT_SECONDARY = "#999";
const USER_BUBBLE = "#2A2A3A";
const KIRA_BUBBLE = "#1E2A1E";

function ChatScreen() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMessageCountRef = useRef(0);

  // Always poll active conversation for new messages (incoming notifications + responses)
  useEffect(() => {
    if (!conversationId) return;

    const poll = async () => {
      try {
        const latest = await getMessages(conversationId);
        // Only update state if messages actually changed
        if (latest.length !== lastMessageCountRef.current) {
          lastMessageCountRef.current = latest.length;
          setMessages(latest);
        }
      } catch {
        // Silently retry
      }
    };

    pollIntervalRef.current = setInterval(poll, 3000);
    poll();
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [conversationId]);

  // Load most recent conversation on startup
  useEffect(() => {
    (async () => {
      try {
        const convos = await getConversations();
        if (convos.length > 0) {
          const latest = convos[0];
          setConversationId(latest.id);
          const msgs = await getMessages(latest.id);
          lastMessageCountRef.current = msgs.length;
          setMessages(msgs);
        }
      } catch {
        // First launch, no conversations yet
      }
    })();
  }, []);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setInput("");

    // Optimistically add user message
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

      // Replace temp message with real one
      const real = await getMessages(result.conversationId);
      setMessages(real);

    } catch {
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempMsg.id),
        { ...tempMsg, content: `[Failed to send] ${text}`, status: "error" },
      ]);
    } finally {
      setSending(false);
    }
  }, [input, sending, conversationId]);

  const startNewConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    lastMessageCountRef.current = 0;
  }, []);

  const syncMessages = useCallback(async () => {
    if (!conversationId) return;
    try {
      const latest = await getMessages(conversationId);
      lastMessageCountRef.current = latest.length;
      setMessages(latest);
    } catch {
      // Silently fail
    }
  }, [conversationId]);

  // --- Voice ---
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const prevMessageCountRef = useRef(0);

  // Speak new assistant messages aloud
  useEffect(() => {
    if (!ttsEnabled || messages.length === 0) return;
    if (messages.length > prevMessageCountRef.current) {
      const newMsgs = messages.slice(prevMessageCountRef.current);
      const lastAssistant = [...newMsgs].reverse().find(
        (m) => m.role === "assistant" && m.status === "complete"
      );
      if (lastAssistant) {
        Speech.speak(lastAssistant.content, {
          language: "en-US",
          rate: 1.0,
          pitch: 1.0,
        });
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, ttsEnabled]);

  const startRecording = useCallback(async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(rec);
      setIsRecording(true);
    } catch {
      // Permission denied or recording failed
    }
  }, []);

  const stopRecordingAndSend = useCallback(async () => {
    if (!recording) return;
    setIsRecording(false);

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);

      if (!uri) return;

      // Transcribe via backend
      const text = await transcribeAudio(uri);
      if (!text || !text.trim()) return;

      // Put transcription in input and send
      setInput(text);
      // Send directly
      setSending(true);
      const tempMsg: Message = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: text,
        status: "pending",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, tempMsg]);

      const result = await sendMessage(text, conversationId || undefined);
      setConversationId(result.conversationId);
      const real = await getMessages(result.conversationId);
      setMessages(real);
      setInput("");
      setSending(false);
    } catch {
      setRecording(null);
      setSending(false);
    }
  }, [recording, conversationId]);

  const renderMessage = useCallback(({ item }: { item: Message }) => {
    const isUser = item.role === "user";
    const isPending = item.status === "pending" || item.status === "processing";

    return (
      <View
        style={[
          styles.messageBubble,
          isUser ? styles.userBubble : styles.kiraBubble,
        ]}
      >
        {!isUser && <Text style={styles.senderLabel}>Kira</Text>}
        <Text style={[styles.messageText, isPending && styles.pendingText]}>
          {item.content}
        </Text>
      </View>
    );
  }, []);

  const isWaiting =
    messages.some(
      (m) => m.role === "user" && (m.status === "pending" || m.status === "processing")
    );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <StatusBar barStyle="light-content" backgroundColor={BG} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerDot} />
          <View>
            <Text style={styles.headerTitle}>Kira</Text>
            <Text style={styles.headerSubtitle}>Personal Assistant</Text>
          </View>
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

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        style={styles.messageList}
        contentContainerStyle={[
          styles.messageListContent,
          messages.length === 0 && styles.emptyList,
        ]}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>Hey, Eric</Text>
            <Text style={styles.emptySubtitle}>What can I help you with?</Text>
          </View>
        }
      />

      {/* Thinking indicator */}
      {isWaiting && (
        <View style={styles.typingContainer}>
          <ActivityIndicator size="small" color={ACCENT} />
          <Text style={styles.typingText}>Kira is thinking...</Text>
        </View>
      )}

      {/* Input */}
      <View style={[styles.inputContainer, { paddingBottom: insets.bottom + 8 }]}>
        {/* TTS toggle */}
        <Pressable
          onPress={() => {
            setTtsEnabled((v) => !v);
            if (ttsEnabled) Speech.stop();
          }}
          style={styles.ttsToggle}
        >
          <Text style={[styles.ttsToggleText, !ttsEnabled && { opacity: 0.3 }]}>
            {ttsEnabled ? "🔊" : "🔇"}
          </Text>
        </Pressable>

        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={isRecording ? "Listening..." : "Message Kira..."}
          placeholderTextColor={isRecording ? ACCENT : TEXT_SECONDARY}
          multiline
          maxLength={5000}
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={handleSend}
          editable={!isRecording}
        />

        {/* Mic button (no text) or Send button (has text) */}
        {input.trim() ? (
          <Pressable
            onPress={handleSend}
            disabled={sending}
            style={[styles.sendButton, sending && styles.sendButtonDisabled]}
          >
            <Text style={styles.sendButtonText}>↑</Text>
          </Pressable>
        ) : (
          <Pressable
            onPressIn={startRecording}
            onPressOut={stopRecordingAndSend}
            style={[styles.sendButton, isRecording && styles.recordingButton]}
          >
            <Text style={styles.sendButtonText}>{isRecording ? "●" : "🎤"}</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ChatScreen />
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
    backgroundColor: ACCENT,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: TEXT_PRIMARY,
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
  senderLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: ACCENT,
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  messageText: {
    fontSize: 16,
    color: TEXT_PRIMARY,
    lineHeight: 22,
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
});
