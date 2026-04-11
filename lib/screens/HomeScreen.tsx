/**
 * HomeScreen — Meditative landing screen.
 * 90% whitespace. KIRA wordmark. Status at a glance.
 * Mirror's Edge "Urban Pulse" aesthetic.
 */

import React, { useEffect, useState, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { Colors, Typography, Spacing } from "../theme";
import { getTerminalStatus } from "../api";

interface StatusData {
  online: boolean;
  terminalActive: boolean;
  unreadAlerts: number;
  lastSeen: string | null;
}

export default function HomeScreen() {
  const [status, setStatus] = useState<StatusData>({
    online: false,
    terminalActive: false,
    unreadAlerts: 0,
    lastSeen: null,
  });
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  // Poll terminal status
  useEffect(() => {
    const check = () =>
      getTerminalStatus()
        .then((s) => setStatus({
          online: s.online ?? false,
          terminalActive: s.terminalActive ?? false,
          unreadAlerts: s.unreadAlerts ?? 0,
          lastSeen: s.lastSeen ?? null,
        }))
        .catch(() => setStatus(prev => ({ ...prev, online: false })));
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  // Cyan dot pulse animation
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const statusParts: string[] = [];
  if (!status.online) {
    statusParts.push("OFFLINE");
  } else {
    statusParts.push("ONLINE");
    if (status.terminalActive) statusParts.push("TERMINAL ACTIVE");
    if (status.unreadAlerts > 0) statusParts.push(`${status.unreadAlerts} ALERT${status.unreadAlerts > 1 ? "S" : ""}`);
  }

  // Green when backend online + terminal active, cyan when online but idle, red when offline
  const dotColor = !status.online
    ? Colors.red
    : status.terminalActive
      ? Colors.green
      : Colors.cyan;

  return (
    <View style={styles.container}>
      {/* Center content */}
      <View style={styles.center}>
        <Text style={styles.wordmark}>KIRA</Text>
        <View style={styles.divider} />
        <View style={styles.statusRow}>
          <Animated.View
            style={[
              styles.pulseDot,
              {
                opacity: pulseAnim,
                backgroundColor: dotColor,
              },
            ]}
          />
          <Text style={[styles.statusText, { color: dotColor }]}>
            {statusParts.join("  ·  ") || "CONNECTING"}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
    justifyContent: "center",
    alignItems: "center",
  },
  center: {
    alignItems: "center",
  },
  wordmark: {
    fontSize: 24,
    fontWeight: "100",
    letterSpacing: 14,
    color: Colors.primary,
    textTransform: "uppercase",
  },
  divider: {
    width: 120,
    height: 1,
    backgroundColor: Colors.surfaceHigh,
    marginVertical: Spacing.lg,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pulseDot: {
    width: 6,
    height: 6,
  },
  statusText: {
    ...Typography.label,
  },
});
