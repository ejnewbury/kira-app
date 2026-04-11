/**
 * ControlsScreen — Building control panel.
 * 2-column grid of flat tiles with real backend actions.
 * Mirror's Edge "Urban Pulse" aesthetic.
 */

import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, Alert, ScrollView } from "react-native";
import { Colors, Typography, Spacing } from "../theme";
import { getTerminalStatus, sendPowerCommand } from "../api";
import { checkForAppUpdate, CURRENT_VERSION } from "../app-updater";

interface ControlTile {
  id: string;
  label: string;
  icon: string;
  status?: "online" | "offline" | "locked" | "unlocked" | "unknown";
  onPress: () => void;
}

export default function ControlsScreen() {
  const [terminalOnline, setTerminalOnline] = useState<boolean | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  useEffect(() => {
    getTerminalStatus()
      .then((s) => setTerminalOnline(s.online))
      .catch(() => setTerminalOnline(false));
  }, []);

  const showFeedback = (msg: string) => {
    setActionFeedback(msg);
    setTimeout(() => setActionFeedback(null), 3000);
  };

  const handlePowerCommand = useCallback(
    (target: "desktop" | "basement", action: "wake" | "sleep" | "shutdown" | "status", label: string) => {
      Alert.alert(
        `${action.toUpperCase()} ${label}`,
        `Send ${action} command to ${label}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: action.toUpperCase(),
            onPress: () => {
              sendPowerCommand(target, action)
                .then((r) => showFeedback(`${label}: ${r.message}`))
                .catch(() => showFeedback(`${label}: Command failed`));
            },
          },
        ]
      );
    },
    []
  );

  const tiles: ControlTile[] = [
    {
      id: "desktop",
      label: "DESKTOP",
      icon: "PWR",
      status: terminalOnline ? "online" : terminalOnline === false ? "offline" : "unknown",
      onPress: () =>
        handlePowerCommand("desktop", terminalOnline ? "sleep" : "wake", "Desktop"),
    },
    {
      id: "basement",
      label: "BASEMENT",
      icon: "PWR",
      status: "unknown",
      onPress: () => handlePowerCommand("basement", "wake", "Basement"),
    },
    {
      id: "jacks-lock",
      label: "JACK'S ROOM",
      icon: "LCK",
      status: "locked",
      onPress: () => showFeedback("Lock control coming soon"),
    },
    {
      id: "doorbell",
      label: "DOORBELL",
      icon: "CAM",
      status: "online",
      onPress: () => showFeedback("Ring events coming soon"),
    },
    {
      id: "phone",
      label: "PHONE",
      icon: "DEV",
      status: "online",
      onPress: () => showFeedback("Device info coming soon"),
    },
    {
      id: "system",
      label: "SYSTEM",
      icon: "SYS",
      status: terminalOnline ? "online" : "offline",
      onPress: () => showFeedback("System diagnostics coming soon"),
    },
  ];

  const getStatusColor = (status?: string) => {
    switch (status) {
      case "online":
      case "unlocked":
        return Colors.green;
      case "offline":
        return Colors.red;
      case "locked":
        return Colors.cyan;
      default:
        return Colors.textFaint;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>CONTROLS</Text>
        <View style={styles.headerRight}>
          <Pressable onPress={() => checkForAppUpdate(false).catch(() => {})} hitSlop={12}>
            <Text style={styles.versionText}>v{CURRENT_VERSION}</Text>
          </Pressable>
          <Pressable onPress={() => {
            getTerminalStatus().then(s => setTerminalOnline(s.online)).catch(() => setTerminalOnline(false));
            showFeedback("Status refreshed");
          }} hitSlop={12}>
            <Text style={styles.syncText}>↻</Text>
          </Pressable>
        </View>
      </View>

      {actionFeedback && (
        <View style={styles.feedbackBar}>
          <Text style={styles.feedbackText}>{actionFeedback}</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.grid}>
        {tiles.map((tile) => (
          <Pressable
            key={tile.id}
            style={({ pressed }) => [
              styles.tile,
              tile.status === "online" && styles.tileActive,
              pressed && styles.tilePressed,
            ]}
            onPress={tile.onPress}
          >
            <View style={styles.tileHeader}>
              <Text style={styles.tileIcon}>{tile.icon}</Text>
              <View
                style={[styles.statusDot, { backgroundColor: getStatusColor(tile.status) }]}
              />
            </View>
            <Text style={styles.tileLabel}>{tile.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
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
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  versionText: {
    ...Typography.meta,
    color: Colors.textFaint,
  },
  syncText: {
    fontSize: 18,
    color: Colors.textSecondary,
  },
  feedbackBar: {
    marginHorizontal: Spacing.screenPadding,
    marginBottom: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surfaceLow,
  },
  feedbackText: {
    ...Typography.label,
    color: Colors.primary,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: Spacing.screenPadding,
    gap: 1,
  },
  tile: {
    width: "49%",
    aspectRatio: 1,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.surfaceHigh,
    padding: Spacing.lg,
    justifyContent: "space-between",
  },
  tileActive: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  tilePressed: {
    backgroundColor: Colors.surfaceLow,
  },
  tileHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tileIcon: {
    fontSize: 18,
    fontWeight: "200",
    letterSpacing: 4,
    color: Colors.textSecondary,
  },
  statusDot: {
    width: 8,
    height: 8,
  },
  tileLabel: {
    ...Typography.label,
    fontSize: 10,
  },
});
