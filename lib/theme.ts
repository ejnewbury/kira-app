/**
 * Kira Design System — "Urban Pulse" / Mirror's Edge Aesthetic
 * Decided April 10, 2026
 *
 * Core principles:
 * - White-topia: #FAFAFA backgrounds, zero shadows, zero gradients
 * - Red-orange primary: #FF4422 — "The Runner's Signal"
 * - Cyan status: #00C8FF — "The Electronic Pulse"
 * - Inter font, thin weights, wide letter-spacing
 * - Sharp geometry: 0 border-radius on content
 * - Color-as-boundary: no 1px borders, use value shifting
 */

export const Colors = {
  // Surfaces (value shifting hierarchy)
  bg: "#FAFAFA",
  surface: "#F9F9F9",
  surfaceLow: "#F3F3F3",
  surfaceContainer: "#EEEEEE",
  surfaceHigh: "#E8E8E8",

  // Primary accent — "The Runner's Signal"
  primary: "#FF4422",
  primaryDark: "#B51D00",

  // Status — "The Electronic Pulse"
  cyan: "#00C8FF",
  green: "#34C759",
  red: "#FF3B30",

  // Text
  text: "#1A1C1C",
  textSecondary: "#999999",
  textFaint: "#CCCCCC",

  // Message bubbles
  sentBubble: "#FF4422",
  sentText: "#FFFFFF",
  receivedBubble: "#EEEEEE",
  receivedText: "#1A1C1C",
  qwenBubble: "#E3F2FD",
  riffBubble: "#FFF8E1",
  // Vex — Kira's sharper-edged little sister. Deeper, moodier red so her
  // bubbles read as "Kira's family" without colliding with the primary.
  vexBubble: "#F5DADA",
  vexLabel: "#C84A4A",

  // Notification source colors
  sentry: "#E03E2F",
  vercel: "#333333",
  supabase: "#3ECF8E",
  email: "#4DA8DA",
  qa: "#FFB74D",
  system: "#999999",

  white: "#FFFFFF",
  black: "#000000",
  transparent: "transparent",
} as const;

export const Typography = {
  // Display — the KIRA wordmark
  display: {
    fontWeight: "100" as const,
    letterSpacing: 12,
    textTransform: "uppercase" as const,
    fontSize: 18,
    color: Colors.primary,
  },
  // Screen titles
  title: {
    fontWeight: "200" as const,
    letterSpacing: 6,
    textTransform: "uppercase" as const,
    fontSize: 14,
    color: Colors.text,
  },
  // Body text
  body: {
    fontWeight: "400" as const,
    fontSize: 14,
    lineHeight: 22,
    color: Colors.text,
  },
  // Small labels — status, timestamps, source tags
  label: {
    fontWeight: "500" as const,
    letterSpacing: 3,
    textTransform: "uppercase" as const,
    fontSize: 9,
    color: Colors.textSecondary,
  },
  // Tiny metadata
  meta: {
    fontWeight: "400" as const,
    letterSpacing: 2,
    textTransform: "uppercase" as const,
    fontSize: 8,
    color: Colors.textFaint,
  },
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  screenPadding: 24,
} as const;

// Transition duration for screen changes (milliseconds)
export const TRANSITION_DURATION = 2000;

// Nav bar icon size
export const NAV_ICON_SIZE = 22;
