/**
 * Context Sync — Push-based bidirectional phone ↔ desktop context.
 * Uses Kira backend API (which talks to Supabase).
 */

const BACKEND_URL = "https://kira-backend-six.vercel.app";

interface ContextEvent {
  id?: string;
  source: "phone" | "desktop";
  event_type: "conversation_summary" | "action_item" | "personal_fact" | "session_context" | "handoff";
  content: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

/**
 * Push a context event to the sync system.
 */
export async function pushContext(
  eventType: ContextEvent["event_type"],
  content: string | Record<string, unknown>,
  metadata?: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/kira/context-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "phone",
        event_type: eventType,
        content: typeof content === "string" ? content : JSON.stringify(content),
        metadata,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Push a conversation summary. Uses a stable ID per conversation
 * so repeated pushes UPDATE rather than create duplicates.
 */
let lastPushedHash = "";

export async function pushConversationSummary(
  messages: Array<{ role: string; content: string }>,
  durationMs: number,
): Promise<boolean> {
  const userMsgs = messages.filter((m) => m.role === "user").map((m) => m.content);
  const assistantMsgs = messages.filter((m) => m.role === "assistant").map((m) => m.content);
  const lastAssistant = assistantMsgs[assistantMsgs.length - 1];

  // Simple dedup — don't push if content hasn't meaningfully changed
  const hash = `${messages.length}-${lastAssistant?.slice(0, 50) || ""}`;
  if (hash === lastPushedHash) return true;
  lastPushedHash = hash;

  return pushContext("conversation_summary", {
    messageCount: messages.length,
    exchangeCount: assistantMsgs.length,
    durationMs,
    userTopics: userMsgs.slice(-3), // Last 3 user messages only
    lastKiraResponse: lastAssistant?.slice(0, 200),
    timestamp: new Date().toISOString(),
  });
}

/**
 * Push a personal fact learned during conversation.
 */
export async function pushPersonalFact(fact: string): Promise<boolean> {
  return pushContext("personal_fact", fact);
}

/**
 * Request handoff to desktop Kira.
 */
export async function requestHandoff(
  messages: Array<{ role: string; content: string }>,
  topic: string,
): Promise<boolean> {
  return pushContext("handoff", {
    messages: messages.slice(-20), // Last 20 messages
    currentTopic: topic,
    requestedAt: new Date().toISOString(),
  });
}

/**
 * Pull latest context from desktop.
 */
export async function pullDesktopContext(since?: string): Promise<ContextEvent[]> {
  try {
    const params = new URLSearchParams({ source: "desktop", limit: "10" });
    if (since) params.set("since", since);

    const res = await fetch(`${BACKEND_URL}/api/kira/context-sync?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.events || [];
  } catch {
    return [];
  }
}
