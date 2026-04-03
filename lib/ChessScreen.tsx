/**
 * Chess Screen — Play chess against Kira.
 * Uses app-level Supabase Realtime listener (in App.tsx) for instant move delivery.
 */

import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, SafeAreaView, Pressable } from "react-native";
import ChessBoard from "./ChessBoard";
import { setChessMoveResolver, setLastChessCommandId, getLastChessMessage } from "../App";

const BACKEND_URL = "https://kira-backend-six.vercel.app";
const API_KEY = "ee35a1f1ea15d2ca456089e562a296382511246a28250de47b82520edae92c14";

export default function ChessScreen({ onClose }: { onClose?: () => void }) {
  const [kiraMessage, setKiraMessage] = useState(getLastChessMessage() || "Let's play! I'm black. Your move.");

  const handleKiraMoveRequest = useCallback(async (fen: string, history: string[]): Promise<string | null> => {
    try {
      const lastMove = history[history.length - 1];
      setKiraMessage("Sending move to Kira...");

      // Send move — backend creates a device_command and long-polls
      const response = await fetch(`${BACKEND_URL}/api/kira/chess-move`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Kira-Api-Key": API_KEY },
        body: JSON.stringify({ fen, history, lastMove }),
      });

      const data = response.ok ? await response.json() : null;
      if (data?.move) {
        if (data.message) setKiraMessage(data.message);
        return data.move;
      }

      // Kira hasn't responded within the long-poll — wait for Realtime via App-level listener
      // Track the command ID so AppState recovery can find it
      if (data?.commandId) setLastChessCommandId(data.commandId);
      setKiraMessage("Kira is thinking...");
      return new Promise<string | null>((resolve) => {
        // Register with app-level resolver
        setChessMoveResolver((move) => {
          const msg = getLastChessMessage();
          if (msg) setKiraMessage(msg);
          resolve(move);
        });

        // 5 minute safety timeout
        setTimeout(() => {
          setChessMoveResolver(null);
          setKiraMessage("Kira will move when she's ready.");
          resolve(null);
        }, 300000);
      });
    } catch (e) {
      console.warn("Chess move request failed:", e);
      setKiraMessage("Connection issue. Try again.");
      return null;
    }
  }, []);

  const handleGameOver = useCallback((result: string) => {
    if (result.includes("Eric")) {
      setKiraMessage("Well played! You got me. Rematch?");
    } else if (result.includes("Kira")) {
      setKiraMessage("Better luck next time! Rematch?");
    } else {
      setKiraMessage("A draw! We're evenly matched.");
    }
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        {onClose && (
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>← Back</Text>
          </Pressable>
        )}
        <Text style={styles.title}>♟ Chess with Kira</Text>
      </View>

      <View style={styles.messageContainer}>
        <Text style={styles.kiraLabel}>Kira:</Text>
        <Text style={styles.kiraMessage}>{kiraMessage}</Text>
      </View>

      <ChessBoard
        onGameOver={handleGameOver}
        onKiraMoveRequest={handleKiraMoveRequest}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0D0D0D", paddingTop: 40 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  closeButton: { marginRight: 12 },
  closeText: { color: "#2A9D8F", fontSize: 16, fontWeight: "600" },
  title: { color: "#E0E0E0", fontSize: 22, fontWeight: "700" },
  messageContainer: { flexDirection: "row", paddingHorizontal: 20, paddingBottom: 8, gap: 8 },
  kiraLabel: { color: "#2A9D8F", fontSize: 14, fontWeight: "700" },
  kiraMessage: { color: "#AAA", fontSize: 14, flex: 1, fontStyle: "italic" },
});
