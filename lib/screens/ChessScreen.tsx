/**
 * Chess Screen — Play chess against Kira.
 * Mirror's Edge "Urban Pulse" aesthetic.
 * Uses app-level Supabase Realtime listener (in App.tsx) for instant move delivery.
 */

import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import ChessBoard from "../ChessBoard";
import { Colors, Typography, Spacing } from "../theme";

const BACKEND_URL = "https://kira-backend-six.vercel.app";

export default function ChessScreen({ onClose }: { onClose?: () => void }) {
  const [kiraMessage, setKiraMessage] = useState("Your move.");

  const handleKiraMoveRequest = useCallback(async (fen: string, _history: string[]): Promise<string | null> => {
    setKiraMessage("THINKING...");
    try {
      const res = await fetch(`${BACKEND_URL}/api/kira/chess-move`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Kira-Api-Key": "ee35a1f1ea15d2ca456089e562a296382511246a28250de47b82520edae92c14",
        },
        body: JSON.stringify({ fen }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.move) {
          setKiraMessage(data.message || "Your turn.");
          return data.move;
        }
      }
    } catch {}
    setKiraMessage("Waiting for response...");
    return null;
  }, []);

  const handleGameOver = useCallback((result: string) => {
    if (result.includes("Eric")) {
      setKiraMessage("WELL PLAYED. REMATCH?");
    } else if (result.includes("Kira")) {
      setKiraMessage("BETTER LUCK NEXT TIME.");
    } else {
      setKiraMessage("A DRAW. EVENLY MATCHED.");
    }
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>CHESS</Text>
        <Text style={styles.turnIndicator}>{kiraMessage}</Text>
      </View>

      <ChessBoard
        onGameOver={handleGameOver}
        onKiraMoveRequest={handleKiraMoveRequest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    paddingHorizontal: Spacing.screenPadding,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    ...Typography.title,
  },
  turnIndicator: {
    ...Typography.label,
    color: Colors.primary,
    fontSize: 9,
  },
});
