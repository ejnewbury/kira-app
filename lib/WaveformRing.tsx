/**
 * WaveformRing — Audio-reactive glowing ring using RN Animated API.
 * Brand colors: burnt sienna → terra cotta → warm gold → amber.
 */

import React, { useEffect, useRef } from "react";
import { View, Animated, Platform } from "react-native";

const BURNT_SIENNA = "#A0522D";
const TERRA_COTTA = "#c87941";
const WARM_GOLD = "#D4A574";

type RingState = "idle" | "listening" | "speechDetected" | "playing";

interface WaveformRingProps {
  state: RingState;
  innerSize: number;
  gap?: number;
  children: React.ReactNode;
}

export default function WaveformRing({
  state,
  innerSize,
  gap = 10,
  children,
}: WaveformRingProps) {
  const ringSize = innerSize + gap * 2;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0.12)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const pulseRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (pulseRef.current) {
      pulseRef.current.stop();
      pulseRef.current = null;
    }

    switch (state) {
      case "idle":
        Animated.parallel([
          Animated.timing(scaleAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(opacityAnim, { toValue: 0.12, duration: 400, useNativeDriver: true }),
          Animated.timing(glowOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
        ]).start();
        break;

      case "listening":
        Animated.parallel([
          Animated.timing(opacityAnim, { toValue: 0.3, duration: 300, useNativeDriver: true }),
          Animated.timing(glowOpacity, { toValue: 0.15, duration: 300, useNativeDriver: true }),
        ]).start();
        pulseRef.current = Animated.loop(
          Animated.sequence([
            Animated.timing(scaleAnim, { toValue: 1.03, duration: 1200, useNativeDriver: true }),
            Animated.timing(scaleAnim, { toValue: 0.97, duration: 1200, useNativeDriver: true }),
          ])
        );
        pulseRef.current.start();
        break;

      case "speechDetected":
        Animated.parallel([
          Animated.timing(opacityAnim, { toValue: 0.85, duration: 200, useNativeDriver: true }),
          Animated.timing(glowOpacity, { toValue: 0.6, duration: 200, useNativeDriver: true }),
        ]).start();
        pulseRef.current = Animated.loop(
          Animated.sequence([
            Animated.timing(scaleAnim, { toValue: 1.12, duration: 350, useNativeDriver: true }),
            Animated.timing(scaleAnim, { toValue: 1.0, duration: 450, useNativeDriver: true }),
          ])
        );
        pulseRef.current.start();
        break;

      case "playing":
        Animated.parallel([
          Animated.timing(opacityAnim, { toValue: 0.9, duration: 250, useNativeDriver: true }),
          Animated.timing(glowOpacity, { toValue: 0.7, duration: 250, useNativeDriver: true }),
        ]).start();
        pulseRef.current = Animated.loop(
          Animated.sequence([
            Animated.timing(scaleAnim, { toValue: 1.15, duration: 500, useNativeDriver: true }),
            Animated.timing(scaleAnim, { toValue: 1.02, duration: 600, useNativeDriver: true }),
          ])
        );
        pulseRef.current.start();
        break;
    }

    return () => {
      if (pulseRef.current) pulseRef.current.stop();
    };
  }, [state]);

  const ringColor = state === "playing" ? WARM_GOLD
    : state === "speechDetected" ? TERRA_COTTA
    : BURNT_SIENNA;

  return (
    <View style={{ width: ringSize, height: ringSize, alignItems: "center", justifyContent: "center" }}>
      {/* Glow layer */}
      <Animated.View
        style={{
          position: "absolute",
          width: ringSize + 4,
          height: ringSize + 4,
          borderRadius: (ringSize + 4) / 2,
          borderWidth: 5,
          borderColor: ringColor,
          opacity: glowOpacity,
          transform: [{ scale: scaleAnim }],
          ...(Platform.OS !== "web" ? {
            shadowColor: ringColor,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.5,
            shadowRadius: 15,
          } : {}),
        }}
      />
      {/* Main ring */}
      <Animated.View
        style={{
          position: "absolute",
          width: ringSize,
          height: ringSize,
          borderRadius: ringSize / 2,
          borderWidth: state === "idle" ? 1.5 : state === "listening" ? 2 : 3,
          borderColor: ringColor,
          opacity: opacityAnim,
          transform: [{ scale: scaleAnim }],
        }}
      />
      {children}
    </View>
  );
}
