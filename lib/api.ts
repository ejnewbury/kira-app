const BACKEND_URL = "https://kira-backend-six.vercel.app";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export async function sendMessage(
  message: string,
  conversationId?: string
): Promise<{ conversationId: string; messageId: string }> {
  const res = await fetch(`${BACKEND_URL}/api/kira/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, conversationId }),
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
