/**
 * CallKiraScreen — Full-screen WebRTC call UI for real-time voice with active Kira.
 *
 * Connects to the Mithra voice-bridge via useCallMode hook.
 */

import React, { useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
  Animated,
  Easing,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Colors } from "../theme";
import { useCallMode, type CallState } from "../call-mode/useCallMode";

interface CallKiraScreenProps {
  onClose: () => void;
}

export default function CallKiraScreen({ onClose }: CallKiraScreenProps) {
  const call = useCallMode({
    onError: (err) => {
      // Logged inside the hook; no-op here. Future: show toast.
    },
  });

  // Auto-start the call on mount
  useEffect(() => {
    call.startCall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // End cleanly on unmount
  useEffect(() => {
    return () => {
      void call.endCall();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-close ~2s after call ends
  useEffect(() => {
    if (call.state === "ended" || call.state === "error") {
      const t = setTimeout(onClose, 1800);
      return () => clearTimeout(t);
    }
  }, [call.state, onClose]);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.bg} />

      <View style={styles.body}>
        <PulseRing state={call.state} />

        <Text style={styles.name}>Kira</Text>
        <StatusLabel state={call.state} duration={call.callDurationSec} error={call.errorMessage} />
      </View>

      <View style={styles.controls}>
        <CircleButton
          label={call.isMuted ? "UNMUTE" : "MUTE"}
          icon={call.isMuted ? "🔇" : "🎙"}
          onPress={call.toggleMute}
          disabled={call.state !== "connected"}
          variant="ghost"
        />
        <CircleButton
          label="END"
          icon="✕"
          onPress={() => {
            void call.endCall();
            onClose();
          }}
          variant="end"
        />
        <View style={styles.spacer} />
      </View>
    </SafeAreaView>
  );
}

/* ───────── Pulse ring (visual indicator for state) ───────── */

function PulseRing({ state }: { state: CallState }) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const opacity = React.useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (state === "connecting" || state === "connected") {
      const loop = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(scale, {
              toValue: 1.15,
              duration: 1100,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(scale, {
              toValue: 1,
              duration: 1100,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(opacity, {
              toValue: 0.7,
              duration: 1100,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 0.4,
              duration: 1100,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      scale.setValue(1);
      opacity.setValue(0.4);
    }
  }, [state, scale, opacity]);

  const ringColor =
    state === "error"
      ? Colors.red
      : state === "connected"
      ? Colors.primary
      : state === "connecting"
      ? Colors.cyan
      : Colors.textFaint;

  return (
    <View style={styles.ringWrap}>
      <Animated.View
        style={[
          styles.ringOuter,
          { borderColor: ringColor, transform: [{ scale }], opacity },
        ]}
      />
      <View style={[styles.ringCore, { backgroundColor: ringColor }]} />
    </View>
  );
}

/* ───────── Status label ───────── */

function StatusLabel({
  state,
  duration,
  error,
}: {
  state: CallState;
  duration: number;
  error: string | null;
}) {
  if (state === "error") {
    return <Text style={[styles.status, { color: Colors.red }]}>{error ?? "Call failed"}</Text>;
  }
  if (state === "ended") {
    return <Text style={styles.status}>Call ended</Text>;
  }
  if (state === "ending") {
    return <Text style={styles.status}>Hanging up…</Text>;
  }
  if (state === "connecting") {
    return <Text style={styles.status}>Connecting…</Text>;
  }
  if (state === "connected") {
    const m = Math.floor(duration / 60);
    const s = duration % 60;
    return (
      <Text style={styles.status}>
        {`${m}:${s.toString().padStart(2, "0")}`}
      </Text>
    );
  }
  return <Text style={styles.status}>Tap to begin…</Text>;
}

/* ───────── Circle button ───────── */

function CircleButton({
  label,
  icon,
  onPress,
  disabled,
  variant = "ghost",
}: {
  label: string;
  icon: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "ghost" | "end";
}) {
  const bg =
    variant === "end" ? Colors.primary : Colors.surfaceContainer;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.btnWrap,
        { opacity: disabled ? 0.4 : 1 },
      ]}
    >
      <View style={[styles.btnCircle, { backgroundColor: bg }]}>
        <Text style={styles.btnIcon}>{icon}</Text>
      </View>
      <Text style={styles.btnLabel}>{label}</Text>
    </Pressable>
  );
}

/* ───────── Styles ───────── */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  ringWrap: {
    width: 220,
    height: 220,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 38,
  },
  ringOuter: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 2,
  },
  ringCore: {
    width: 110,
    height: 110,
    borderRadius: 55,
    opacity: 0.85,
  },
  name: {
    color: Colors.text,
    fontSize: 32,
    fontWeight: "300",
    letterSpacing: 4,
    marginBottom: 8,
  },
  status: {
    color: Colors.textSecondary,
    fontSize: 16,
    letterSpacing: 1.5,
  },
  controls: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center",
    paddingHorizontal: 28,
    paddingBottom: 28,
  },
  btnWrap: {
    alignItems: "center",
    gap: 8,
  },
  btnCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: "center",
    justifyContent: "center",
  },
  btnIcon: {
    fontSize: 26,
    color: Colors.text,
  },
  btnLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    letterSpacing: 2,
  },
  spacer: {
    width: 70,
    height: 70,
  },
});
