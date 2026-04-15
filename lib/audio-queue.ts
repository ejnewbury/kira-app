/**
 * AudioQueueManager — Serializes TTS playback so voices don't overlap.
 *
 * Features:
 * - FIFO queue: messages play one at a time in order
 * - Speaker tracking: knows who's currently speaking (kira, qwenboy, system)
 * - Callbacks for UI: onSpeakerChange fires when active speaker changes
 * - Interrupt support: can clear queue and stop current playback
 */

import * as PiperTTS from "./piper-tts";

export type Speaker = "kira" | "vex" | "qwenboy" | "riffbot" | "system" | null;

interface QueueItem {
  text: string;
  speaker: Speaker;
  messageId?: string;
}

type SpeakerChangeCallback = (speaker: Speaker, messageId?: string) => void;

class AudioQueueManager {
  private queue: QueueItem[] = [];
  private isPlaying = false;
  private currentSpeaker: Speaker = null;
  private currentMessageId?: string;
  private onSpeakerChangeCallbacks: SpeakerChangeCallback[] = [];

  /**
   * Add a message to the playback queue.
   */
  enqueue(text: string, speaker: Speaker = "kira", messageId?: string): void {
    if (!text?.trim()) return;
    this.queue.push({ text, speaker, messageId });
    this.processQueue();
  }

  /**
   * Stop current playback and clear the queue.
   */
  async interrupt(): Promise<void> {
    this.queue = [];
    this.isPlaying = false;
    await PiperTTS.stop();
    this.setSpeaker(null);
  }

  /**
   * Stop current playback but keep queue intact.
   */
  async skipCurrent(): Promise<void> {
    await PiperTTS.stop();
    // isPlaying will be set to false by the playback completion handler
  }

  /**
   * Register a callback for speaker changes (for UI bubble animation).
   * Returns unsubscribe function.
   */
  onSpeakerChange(callback: SpeakerChangeCallback): () => void {
    this.onSpeakerChangeCallbacks.push(callback);
    return () => {
      this.onSpeakerChangeCallbacks = this.onSpeakerChangeCallbacks.filter(
        (cb) => cb !== callback
      );
    };
  }

  /**
   * Get the currently speaking entity.
   */
  getCurrentSpeaker(): Speaker {
    return this.currentSpeaker;
  }

  /**
   * Get the message ID of the currently playing message.
   */
  getCurrentMessageId(): string | undefined {
    return this.currentMessageId;
  }

  /**
   * Check if anything is playing or queued.
   */
  isActive(): boolean {
    return this.isPlaying || this.queue.length > 0;
  }

  /**
   * Get queue length.
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  private setSpeaker(speaker: Speaker, messageId?: string): void {
    if (this.currentSpeaker !== speaker || this.currentMessageId !== messageId) {
      this.currentSpeaker = speaker;
      this.currentMessageId = messageId;
      for (const cb of this.onSpeakerChangeCallbacks) {
        try {
          cb(speaker, messageId);
        } catch {}
      }
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isPlaying || this.queue.length === 0) return;

    this.isPlaying = true;
    const item = this.queue.shift()!;

    this.setSpeaker(item.speaker, item.messageId);

    try {
      // Vex doesn't have a Piper voice yet — route her through Kira's voice for
      // now. Replace with a Vex-specific voice model once we fine-tune one.
      const ttsSpeaker =
        item.speaker === "qwenboy"
          ? "qwenboy"
          : item.speaker === "riffbot"
          ? "riffbot"
          : "kira";
      await PiperTTS.speak(item.text, ttsSpeaker);
    } catch (e) {
      console.warn("[AudioQueue] Playback error:", e);
    }

    this.isPlaying = false;
    this.setSpeaker(null);

    // Process next item if queue has more
    if (this.queue.length > 0) {
      this.processQueue();
    }
  }
}

// Singleton instance
export const audioQueue = new AudioQueueManager();
