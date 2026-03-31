/**
 * AmbientGlow — Full-screen animated background effect for voice mode.
 *
 * Sits behind chat messages as a subtle gradient pulse that reacts to voice state.
 * Uses radial gradient simulation via layered Animated Views with opacity/scale.
 *
 * States:
 * - idle: nearly invisible, very faint warm tint
 * - listening: gentle breathing pulse, low opacity warm glow from bottom
 * - speechDetected: active pulsing, terra cotta glow intensifies
 * - playing: warm amber bloom, smooth rhythmic expansion
 */

import React, { useEffect, useRef } from "react";
import { View, Animated, StyleSheet, Dimensions } from "react-native";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// Brand colors
const BURNT_SIENNA = "#A0522D";
const TERRA_COTTA = "#c87941";
const WARM_GOLD = "#D4A574";
const AMBER = "#D4943A";
const DEEP_BG = "#0D0D0D";

type GlowState = "idle" | "listening" | "speechDetected" | "playing";

interface AmbientGlowProps {
  state: GlowState;
}

export default function AmbientGlow({ state }: AmbientGlowProps) {
  // Bottom glow orb
  const bottomOpacity = useRef(new Animated.Value(0)).current;
  const bottomScale = useRef(new Animated.Value(0.8)).current;

  // Top accent orb
  const topOpacity = useRef(new Animated.Value(0)).current;
  const topScale = useRef(new Animated.Value(0.6)).current;

  // Center pulse
  const centerOpacity = useRef(new Animated.Value(0)).current;
  const centerScale = useRef(new Animated.Value(0.5)).current;

  const pulseRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (pulseRef.current) {
      pulseRef.current.stop();
      pulseRef.current = null;
    }

    switch (state) {
      case "idle":
        Animated.parallel([
          Animated.timing(bottomOpacity, { toValue: 0.03, duration: 600, useNativeDriver: true }),
          Animated.timing(bottomScale, { toValue: 0.8, duration: 600, useNativeDriver: true }),
          Animated.timing(topOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
          Animated.timing(centerOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
        ]).start();
        break;

      case "listening":
        // Gentle breathing — bottom glow fades in, subtle pulse
        Animated.parallel([
          Animated.timing(bottomOpacity, { toValue: 0.08, duration: 500, useNativeDriver: true }),
          Animated.timing(topOpacity, { toValue: 0.03, duration: 500, useNativeDriver: true }),
          Animated.timing(centerOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
        ]).start();

        pulseRef.current = Animated.loop(
          Animated.sequence([
            Animated.parallel([
              Animated.timing(bottomScale, { toValue: 1.05, duration: 2000, useNativeDriver: true }),
              Animated.timing(bottomOpacity, { toValue: 0.1, duration: 2000, useNativeDriver: true }),
            ]),
            Animated.parallel([
              Animated.timing(bottomScale, { toValue: 0.9, duration: 2000, useNativeDriver: true }),
              Animated.timing(bottomOpacity, { toValue: 0.06, duration: 2000, useNativeDriver: true }),
            ]),
          ])
        );
        pulseRef.current.start();
        break;

      case "speechDetected":
        // Active — terra cotta glow, faster pulse, center orb appears
        Animated.parallel([
          Animated.timing(bottomOpacity, { toValue: 0.18, duration: 300, useNativeDriver: true }),
          Animated.timing(topOpacity, { toValue: 0.08, duration: 300, useNativeDriver: true }),
          Animated.timing(centerOpacity, { toValue: 0.12, duration: 200, useNativeDriver: true }),
        ]).start();

        pulseRef.current = Animated.loop(
          Animated.sequence([
            Animated.parallel([
              Animated.timing(bottomScale, { toValue: 1.15, duration: 400, useNativeDriver: true }),
              Animated.timing(centerScale, { toValue: 0.7, duration: 400, useNativeDriver: true }),
              Animated.timing(centerOpacity, { toValue: 0.15, duration: 400, useNativeDriver: true }),
            ]),
            Animated.parallel([
              Animated.timing(bottomScale, { toValue: 0.95, duration: 500, useNativeDriver: true }),
              Animated.timing(centerScale, { toValue: 0.5, duration: 500, useNativeDriver: true }),
              Animated.timing(centerOpacity, { toValue: 0.08, duration: 500, useNativeDriver: true }),
            ]),
          ])
        );
        pulseRef.current.start();
        break;

      case "playing":
        // Warm amber bloom — full glow, smooth rhythmic expansion
        Animated.parallel([
          Animated.timing(bottomOpacity, { toValue: 0.2, duration: 400, useNativeDriver: true }),
          Animated.timing(topOpacity, { toValue: 0.1, duration: 400, useNativeDriver: true }),
          Animated.timing(centerOpacity, { toValue: 0.15, duration: 400, useNativeDriver: true }),
        ]).start();

        pulseRef.current = Animated.loop(
          Animated.sequence([
            Animated.parallel([
              Animated.timing(bottomScale, { toValue: 1.2, duration: 600, useNativeDriver: true }),
              Animated.timing(topScale, { toValue: 0.8, duration: 600, useNativeDriver: true }),
              Animated.timing(centerScale, { toValue: 0.65, duration: 600, useNativeDriver: true }),
            ]),
            Animated.parallel([
              Animated.timing(bottomScale, { toValue: 1.0, duration: 700, useNativeDriver: true }),
              Animated.timing(topScale, { toValue: 0.6, duration: 700, useNativeDriver: true }),
              Animated.timing(centerScale, { toValue: 0.5, duration: 700, useNativeDriver: true }),
            ]),
          ])
        );
        pulseRef.current.start();
        break;
    }

    return () => {
      if (pulseRef.current) pulseRef.current.stop();
    };
  }, [state]);

  const bottomColor = state === "playing" ? AMBER
    : state === "speechDetected" ? TERRA_COTTA
    : BURNT_SIENNA;

  const topColor = state === "playing" ? WARM_GOLD
    : state === "speechDetected" ? BURNT_SIENNA
    : BURNT_SIENNA;

  const centerColor = state === "playing" ? WARM_GOLD : TERRA_COTTA;

  return (
    <View style={styles.container} pointerEvents="none">
      {/* Bottom glow orb — primary, rises from bottom center */}
      <Animated.View
        style={[
          styles.orb,
          styles.bottomOrb,
          {
            backgroundColor: bottomColor,
            opacity: bottomOpacity,
            transform: [{ scale: bottomScale }],
          },
        ]}
      />

      {/* Top accent orb — subtle, top-right area */}
      <Animated.View
        style={[
          styles.orb,
          styles.topOrb,
          {
            backgroundColor: topColor,
            opacity: topOpacity,
            transform: [{ scale: topScale }],
          },
        ]}
      />

      {/* Center pulse orb — appears during active speech */}
      <Animated.View
        style={[
          styles.orb,
          styles.centerOrb,
          {
            backgroundColor: centerColor,
            opacity: centerOpacity,
            transform: [{ scale: centerScale }],
          },
        ]}
      />
    </View>
  );
}

const ORB_SIZE = Math.max(SCREEN_WIDTH, SCREEN_HEIGHT) * 0.8;

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  orb: {
    position: "absolute",
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
  },
  bottomOrb: {
    bottom: -ORB_SIZE * 0.4,
    left: (SCREEN_WIDTH - ORB_SIZE) / 2,
  },
  topOrb: {
    top: -ORB_SIZE * 0.5,
    right: -ORB_SIZE * 0.3,
  },
  centerOrb: {
    top: SCREEN_HEIGHT * 0.3 - ORB_SIZE / 2,
    left: (SCREEN_WIDTH - ORB_SIZE) / 2,
  },
});
