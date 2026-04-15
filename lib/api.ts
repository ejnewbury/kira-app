const BACKEND_URL = "https://kira-backend-six.vercel.app";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  source?: string; // "user" | "terminal" | "daemon" | "system"
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export type Recipient = "kira" | "vex" | "both";

export async function sendMessage(
  message: string,
  conversationId?: string,
  imageBase64?: string,
  recipient: Recipient = "kira"
): Promise<{ conversationId: string; messageId: string }> {
  // If image attached, upload to Supabase Storage first (bypasses Vercel 4.5MB limit)
  let imagePath: string | undefined;
  if (imageBase64) {
    try {
      const { supabase } = require("./supabase");
      const fileName = `${Date.now()}.jpg`;
      const filePath = `uploads/${fileName}`;

      // Decode base64 to Uint8Array for upload
      const binaryStr = atob(imageBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const { error: uploadErr } = await supabase.storage
        .from("kira-images")
        .upload(filePath, bytes.buffer, {
          contentType: "image/jpeg",
          upsert: true,
        });

      if (!uploadErr) {
        imagePath = filePath;
        console.log("[API] Image uploaded:", filePath);
      } else {
        console.warn("[API] Image upload failed:", uploadErr.message);
      }
    } catch (e: any) {
      console.warn("[API] Image upload error:", e?.message || e);
    }
  }

  const body: Record<string, string | undefined> = {
    message: imagePath ? `[IMAGE:${imagePath}]\n${message || "What's in this image?"}` : message,
    conversationId,
    recipient,
    ...(imagePath && { imagePath }),
  };

  const res = await fetch(`${BACKEND_URL}/api/kira/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Send failed: ${res.status}`);
  return res.json();
}

export async function getMessages(
  conversationId: string,
  since?: string
): Promise<Message[]> {
  let url = `${BACKEND_URL}/api/kira/messages?conversationId=${conversationId}`;
  if (since) url += `&since=${encodeURIComponent(since)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Messages failed: ${res.status}`);
  const data = await res.json();
  return data.messages;
}

export async function getConversations(): Promise<Conversation[]> {
  const res = await fetch(`${BACKEND_URL}/api/kira/conversations`);
  if (!res.ok) throw new Error(`Conversations failed: ${res.status}`);
  const data = await res.json();
  return data.conversations;
}

export async function transcribeAudio(uri: string): Promise<string> {
  const formData = new FormData();
  const filename = uri.split("/").pop() || "recording.m4a";
  formData.append("audio", {
    uri,
    type: "audio/m4a",
    name: filename,
  } as any);

  const res = await fetch(`${BACKEND_URL}/api/kira/transcribe`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(`Transcribe failed: ${res.status}`);
  const data = await res.json();
  return data.text || "";
}

export interface AgentMessage {
  id: string;
  role: string;
  content: string;
  source: string;
  status: string;
  created_at: string;
}

/** Check Kira system status — backend health, terminal activity, alert count */
export async function getTerminalStatus(): Promise<{
  online: boolean | null;
  terminalActive: boolean | null;
  lastSeen: string | null;
  unreadAlerts: number;
}> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(`${BACKEND_URL}/api/kira/terminal-status`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return { online: null, terminalActive: null, lastSeen: null, unreadAlerts: 0 };
    const data = await res.json();
    return {
      online: data.online ?? false,
      terminalActive: data.terminalActive ?? false,
      lastSeen: data.lastSeen ?? null,
      unreadAlerts: data.unreadAlerts ?? 0,
    };
  } catch (e) {
    console.log("[status] fetch failed:", e);
    return { online: null, terminalActive: null, lastSeen: null, unreadAlerts: 0 };
  }
}

/** Send a power command (wake/sleep) to a machine via smart plug or WoL */
export async function sendPowerCommand(
  target: string,
  action: "wake" | "sleep" | "shutdown" | "status"
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/kira/power-control`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Kira-Api-Key": "ee35a1f1ea15d2ca456089e562a296382511246a28250de47b82520edae92c14",
      },
      body: JSON.stringify({ target, action }),
    });
    if (!res.ok) return { success: false, message: `Error: ${res.status}` };
    return await res.json();
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/** Send a home control command (lock, unlock, doorbell, system, etc.) */
export async function sendHomeControl(
  command: string,
  target: string,
  args: Record<string, unknown> = {}
): Promise<{ id: string; status: string }> {
  const res = await fetch(`${BACKEND_URL}/api/kira/home-control`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Kira-Api-Key": "ee35a1f1ea15d2ca456089e562a296382511246a28250de47b82520edae92c14",
    },
    body: JSON.stringify({ command, target, args }),
  });
  if (!res.ok) throw new Error(`Home control failed: ${res.status}`);
  return await res.json();
}

export async function getAgentChat(
  since?: string,
  limit: number = 20
): Promise<AgentMessage[]> {
  let url = `${BACKEND_URL}/api/kira/agent-chat?limit=${limit}`;
  if (since) url += `&since=${encodeURIComponent(since)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Agent chat failed: ${res.status}`);
  const data = await res.json();
  return data.messages;
}
