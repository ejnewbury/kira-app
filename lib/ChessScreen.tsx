/**
 * Chess Screen — Play chess against Kira.
 *
 * Sends moves to the Kira backend which forwards to the chess MCP server.
 * Kira's moves come back and are applied to the board.
 */

import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, SafeAreaView, Pressable } from "react-native";
import ChessBoard from "./ChessBoard";
import { supabase } from "./supabase";

const BACKEND_URL = "https://kira-backend-six.vercel.app";

export default function ChessScreen({ onClose }: { onClose?: () => void }) {
  const [kiraMessage, setKiraMessage] = useState("Let's play! I'm black. Your move.");

  const handleKiraMoveRequest = useCallback(async (fen: string, history: string[]): Promise<string | null> => {
    try {
      // Get the last move Eric made (the most recent move in history)
      const lastMove = history[history.length - 1];

      // Send Eric's move to the backend, which will use the chess MCP
      // For now, use a simple evaluation — the chess MCP server handles this
      // We'll call the backend endpoint that forwards to the MCP

      // Temporary: use a simple response until we wire the backend
      // Just make a reasonable move by picking from common openings/responses
      const response = await fetch(`${BACKEND_URL}/api/kira/chess-move`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Kira-Api-Key": "ee35a1f1ea15d2ca456089e562a296382511246a28250de47b82520edae92c14",
        },
        body: JSON.stringify({ fen, history, lastMove }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.move) {
          if (data.message) setKiraMessage(data.message);
          return data.move;
        }
        // Kira is still thinking — wait and retry
        if (response.status === 202 || !data.move) {
          setKiraMessage("Kira is thinking...");
          // Wait 5s and retry once
          await new Promise((r) => setTimeout(r, 5000));
          const retry = await fetch(`${BACKEND_URL}/api/kira/chess-move`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Kira-Api-Key": "ee35a1f1ea15d2ca456089e562a296382511246a28250de47b82520edae92c14",
            },
            body: JSON.stringify({ fen, history, lastMove }),
          });
          if (retry.ok) {
            const retryData = await retry.json();
            if (retryData.move) {
              if (retryData.message) setKiraMessage(retryData.message);
              return retryData.move;
            }
          }
        }
      }

      setKiraMessage("Still thinking... give me a moment.");
      return null;
    } catch (e) {
      console.warn("Chess move request failed:", e);
      setKiraMessage("Connection issue — making a random move.");
      return null;
    }
  }, []);

  const handleGameOver = useCallback((result: string) => {
    if (result.includes("Eric")) {
      setKiraMessage("Well played! You got me. Rematch?");
    } else if (result.includes("Kira")) {
      setKiraMessage("Better luck next time! 😏 Rematch?");
    } else {
      setKiraMessage("A draw! We're evenly matched.");
    }
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        {onClose && (
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>← Back</Text>
          </Pressable>
        )}
        <Text style={styles.title}>♟ Chess with Kira</Text>
      </View>

      {/* Kira's message */}
      <View style={styles.messageContainer}>
        <Text style={styles.kiraLabel}>Kira:</Text>
        <Text style={styles.kiraMessage}>{kiraMessage}</Text>
      </View>

      {/* Board */}
      <ChessBoard
        onGameOver={handleGameOver}
        onKiraMoveRequest={handleKiraMoveRequest}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0D0D0D",
    paddingTop: 40,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  closeButton: {
    marginRight: 12,
  },
  closeText: {
    color: "#2A9D8F",
    fontSize: 16,
    fontWeight: "600",
  },
  title: {
    color: "#E0E0E0",
    fontSize: 22,
    fontWeight: "700",
  },
  messageContainer: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 8,
  },
  kiraLabel: {
    color: "#2A9D8F",
    fontSize: 14,
    fontWeight: "700",
  },
  kiraMessage: {
    color: "#AAA",
    fontSize: 14,
    flex: 1,
    fontStyle: "italic",
  },
});
