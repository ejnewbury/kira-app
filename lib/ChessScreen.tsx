/**
 * Chess Screen — Play chess against Kira.
 * Uses app-level Supabase Realtime listener (in App.tsx) for instant move delivery.
 */

import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, SafeAreaView, Pressable } from "react-native";
import ChessBoard from "./ChessBoard";

export default function ChessScreen({ onClose }: { onClose?: () => void }) {
  const [kiraMessage, setKiraMessage] = useState("Let's play! I'm black. Your move.");

  // Kira's moves now come via Supabase Realtime (handled in ChessBoard)
  // This callback is no longer needed for move requests — just for status messages
  const handleKiraMoveRequest = useCallback(async (_fen: string, _history: string[]): Promise<string | null> => {
    setKiraMessage("Kira is thinking...");
    // Return null — ChessBoard will receive Kira's move via Realtime subscription
    return null;
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
