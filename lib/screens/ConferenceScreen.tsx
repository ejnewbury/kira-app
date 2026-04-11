/**
 * ConferenceScreen — Multi-agent brainstorm chat.
 * Kira Swarm agents discuss topics in real-time.
 * Mirror's Edge "Urban Pulse" aesthetic.
 *
 * Agents:
 * - Kira (primary, red-orange)
 * - QwenBoy (blue)
 * - UI Architect (cyan)
 * - Product Strategist (amber)
 * - Devil's Advocate (red)
 * - Synthesizer (green)
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, TextInput, FlatList, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, Typography, Spacing } from "../theme";
import { supabase } from "../supabase";

const BACKEND_URL = "https://kira-backend-six.vercel.app";
const API_KEY = "ee35a1f1ea15d2ca456089e562a296382511246a28250de47b82520edae92c14";

interface ConferenceMessage {
  id: string;
  agent: string;
  content: string;
  created_at: string;
}

const AGENT_STYLES: Record<string, { color: string; label: string }> = {
  kira: { color: Colors.primary, label: "KIRA" },
  qwenboy: { color: "#5B8DEF", label: "QWENBOY" },
  ui_architect: { color: Colors.cyan, label: "UI ARCHITECT" },
  product_strategist: { color: "#FFB74D", label: "STRATEGIST" },
  devils_advocate: { color: "#E03E2F", label: "DEVIL'S ADVOCATE" },
  synthesizer: { color: Colors.green, label: "SYNTHESIZER" },
  eric: { color: Colors.textSecondary, label: "ERIC" },
};

export default function ConferenceScreen() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ConferenceMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // Start a new conference session or load existing
  useEffect(() => {
    loadLatestSession();
  }, []);

  // Subscribe to Realtime for new conference messages
  useEffect(() => {
    if (!sessionId) return;

    const channel = supabase
      .channel(`conference:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conference_messages",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const msg = payload.new as any;
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, {
              id: msg.id,
              agent: msg.agent || "system",
              content: msg.content,
              created_at: msg.created_at,
            }];
          });
          setThinking(false);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [sessionId]);

  const loadLatestSession = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("conference_sessions")
        .select("id")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (data) {
        setSessionId(data.id);
        const { data: msgs } = await supabase
          .from("conference_messages")
          .select("*")
          .eq("session_id", data.id)
          .order("created_at", { ascending: true });
        if (msgs) setMessages(msgs.map((m: any) => ({
          id: m.id, agent: m.agent, content: m.content, created_at: m.created_at,
        })));
      }
    } catch {}
  }, []);

  const startNewSession = useCallback(async (topic: string) => {
    try {
      const { data } = await supabase
        .from("conference_sessions")
        .insert({ topic, status: "active" })
        .select()
        .single();
      if (data) {
        setSessionId(data.id);
        setMessages([]);
        return data.id;
      }
    } catch {}
    return null;
  }, []);

  const sendPrompt = useCallback(async () => {
    const text = input.trim();
    if (!text || thinking) return;
    setInput("");
    setThinking(true);

    let sid = sessionId;
    if (!sid) {
      sid = await startNewSession(text);
      if (!sid) { setThinking(false); return; }
    }

    // Add Eric's message locally
    const ericMsg: ConferenceMessage = {
      id: `local-${Date.now()}`,
      agent: "eric",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, ericMsg]);

    // Save Eric's message to DB
    try {
      await supabase.from("conference_messages").insert({
        session_id: sid,
        agent: "eric",
        content: text,
      });
    } catch {}

    // Trigger the conference backend — agents will post their responses
    try {
      await fetch(`${BACKEND_URL}/api/kira/conference`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Kira-Api-Key": API_KEY,
        },
        body: JSON.stringify({ sessionId: sid, prompt: text }),
      });
    } catch {
      setThinking(false);
    }
  }, [input, thinking, sessionId, startNewSession]);

  const renderMessage = useCallback(({ item }: { item: ConferenceMessage }) => {
    const style = AGENT_STYLES[item.agent] || { color: Colors.textSecondary, label: item.agent.toUpperCase() };
    const isEric = item.agent === "eric";

    return (
      <View style={[styles.message, isEric && styles.ericMessage]}>
        <View style={[styles.agentBorder, { backgroundColor: style.color }]} />
        <View style={styles.messageContent}>
          <Text style={[styles.agentLabel, { color: style.color }]}>{style.label}</Text>
          <Text style={styles.messageText}>{item.content}</Text>
          <Text style={styles.messageTime}>
            {new Date(item.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </Text>
        </View>
      </View>
    );
  }, []);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.header}>
        <Text style={styles.title}>CONFERENCE</Text>
        <Pressable onPress={() => { setSessionId(null); setMessages([]); }} hitSlop={12}>
          <Text style={styles.newSessionLabel}>NEW</Text>
        </Pressable>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>CONFERENCE</Text>
            <Text style={styles.emptySubtext}>Pose a question. The team will brainstorm.</Text>
          </View>
        }
      />

      {thinking && (
        <View style={styles.thinkingBar}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.thinkingText}>AGENTS THINKING</Text>
        </View>
      )}

      <View style={[styles.inputOuter, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.inputPill}>
          <TextInput
            style={styles.textInput}
            value={input}
            onChangeText={setInput}
            placeholder="Ask the team..."
            placeholderTextColor={Colors.textFaint}
            multiline
            maxLength={2000}
          />
          <Pressable
            onPress={sendPrompt}
            disabled={thinking}
            style={[styles.sendButton, thinking && { opacity: 0.3 }]}
          >
            <Text style={styles.sendIcon}>↑</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPadding,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  title: {
    ...Typography.title,
  },
  newSessionLabel: {
    ...Typography.label,
    color: Colors.primary,
    fontSize: 9,
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    padding: Spacing.screenPadding,
    gap: 2,
  },
  message: {
    flexDirection: "row",
    backgroundColor: Colors.white,
  },
  ericMessage: {
    backgroundColor: Colors.surfaceLow,
  },
  agentBorder: {
    width: 3,
  },
  messageContent: {
    flex: 1,
    padding: 14,
  },
  agentLabel: {
    ...Typography.meta,
    letterSpacing: 3,
    marginBottom: 4,
  },
  messageText: {
    fontSize: 13,
    color: Colors.text,
    lineHeight: 20,
  },
  messageTime: {
    ...Typography.meta,
    marginTop: 6,
    alignSelf: "flex-end",
  },
  empty: {
    alignItems: "center",
    paddingTop: 80,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "100",
    letterSpacing: 10,
    color: Colors.primary,
  },
  emptySubtext: {
    ...Typography.label,
    color: Colors.textFaint,
  },
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
  textInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "400",
    color: Colors.text,
    maxHeight: 100,
    minHeight: 36,
    paddingHorizontal: 12,
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
});
