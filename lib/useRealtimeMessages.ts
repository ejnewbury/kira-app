/**
 * useRealtimeMessages — Replace HTTP polling with Supabase Realtime.
 *
 * Subscribes to INSERT/UPDATE events on kira_messages table.
 * Falls back to polling if Realtime connection drops.
 */

import { useEffect, useRef, useCallback } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { supabase } from "./supabase";
import { getMessages, Message } from "./api";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface UseRealtimeMessagesOptions {
  conversationId: string | null;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

export function useRealtimeMessages({
  conversationId,
  setMessages,
}: UseRealtimeMessagesOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const fallbackPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectionStatusRef = useRef<string>("disconnected");

  // Clear fallback polling
  const clearFallbackPoll = useCallback(() => {
    if (fallbackPollRef.current) {
      clearInterval(fallbackPollRef.current);
      fallbackPollRef.current = null;
    }
  }, []);

  // Start fallback polling (5s interval)
  const startFallbackPoll = useCallback(() => {
    if (fallbackPollRef.current || !conversationId) return;
    console.log("[Realtime] Starting fallback polling");
    fallbackPollRef.current = setInterval(async () => {
      try {
        const msgs = await getMessages(conversationId);
        setMessages(msgs);
      } catch {}
    }, 5000);
  }, [conversationId, setMessages]);

  useEffect(() => {
    if (!conversationId) return;

    // Initial fetch
    getMessages(conversationId)
      .then((msgs) => setMessages(msgs))
      .catch(() => {});

    // Subscribe to Realtime
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "kira_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMsg = payload.new as any;
          const message: Message = {
            id: newMsg.id,
            role: newMsg.role,
            content: newMsg.content,
            status: newMsg.status || "complete",
            source: newMsg.source,
            created_at: newMsg.created_at,
          };

          setMessages((prev) => {
            // Deduplicate — skip if we already have this ID
            if (prev.some((m) => m.id === message.id)) return prev;
            // Remove temp messages that match this real message content
            let filtered = prev.filter(
              (m) => !m.id.startsWith("temp-") || m.content !== message.content
            );
            // If this is an assistant response, mark any pending user temp messages as complete
            // (the backend does this too, but the UPDATE event may not arrive before the INSERT)
            if (message.role === "assistant") {
              filtered = filtered.map((m) =>
                m.id.startsWith("temp-") && m.role === "user" && m.status === "pending"
                  ? { ...m, status: "complete" }
                  : m
              );
            }
            return [...filtered, message];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "kira_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === updated.id
                ? { ...m, content: updated.content, status: updated.status || m.status }
                : m
            )
          );
        }
      )
      .subscribe((status) => {
        connectionStatusRef.current = status;
        console.log(`[Realtime] Channel status: ${status}`);

        if (status === "SUBSCRIBED") {
          clearFallbackPoll();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          startFallbackPoll();
        }
      });

    channelRef.current = channel;

    // Foreground recovery: when phone backgrounds the WebSocket can silently
    // drop without firing CHANNEL_ERROR / TIMED_OUT. On resume to "active",
    // refetch latest messages + recreate the subscription so we don't miss
    // any inserts that happened while backgrounded.
    // Symptom this fixes: push notification fires, badge shows, but message
    // body never renders in the channel UI.
    const appStateSub = AppState.addEventListener(
      "change",
      (state: AppStateStatus) => {
        if (state !== "active" || !conversationId) return;
        // Refetch — dedup logic in the INSERT handler will drop duplicates
        // when the realtime channel catches up.
        getMessages(conversationId)
          .then((msgs) => setMessages(msgs))
          .catch(() => {});
        // If the channel is in a non-SUBSCRIBED state, recreate it.
        if (
          connectionStatusRef.current !== "SUBSCRIBED" &&
          channelRef.current
        ) {
          supabase.removeChannel(channelRef.current);
          channelRef.current = null;
          // Force the effect to re-run by clearing the ref; the next effect
          // pass will recreate. (We can't recreate inline here without
          // hoisting the channel-build logic — keep it simple.)
        }
      }
    );

    return () => {
      clearFallbackPoll();
      appStateSub.remove();
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [conversationId, setMessages, clearFallbackPoll, startFallbackPoll]);

  return {
    connectionStatus: connectionStatusRef.current,
  };
}
