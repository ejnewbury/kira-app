/**
 * Kira App — Navigation Shell
 * Mirror's Edge "Urban Pulse" design system.
 * 5 screens with 2-second transitions.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { View, StyleSheet, AppState, Pressable, Animated, Easing, StatusBar } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import * as NavigationBar from "expo-navigation-bar";
import * as Sentry from "@sentry/react-native";

Sentry.init({
  dsn: "https://7a1613ca1fa8d01fb0e6d675619463f0@o4510907057307648.ingest.us.sentry.io/4511201789673472",
  tracesSampleRate: 0.2,
  enableAutoSessionTracking: true,
  debug: false,
});
import { supabase } from "./lib/supabase";
import { Colors, TRANSITION_DURATION, NAV_ICON_SIZE } from "./lib/theme";

// Screens
import HomeScreen from "./lib/screens/HomeScreen";
import ChatScreen from "./lib/screens/ChatScreen";
import ControlsScreen from "./lib/screens/ControlsScreen";
import AlertsScreen from "./lib/screens/AlertsScreen";
import ChessScreen from "./lib/screens/ChessScreen";
import ConferenceScreen from "./lib/screens/ConferenceScreen";
import CallKiraScreen from "./lib/screens/CallKiraScreen";

// --- Call mode (app-level overlay) ---
let setCallScreenVisibleRef: ((visible: boolean) => void) | null = null;

export function openCallScreen() {
  setCallScreenVisibleRef?.(true);
}
export function closeCallScreen() {
  setCallScreenVisibleRef?.(false);
}

// --- Chess move routing (app-level, survives screen switches) ---
let pendingChessMoveResolve: ((move: string | null) => void) | null = null;
let lastChessMessage = "";
let lastChessCommandId: string | null = null;
let pendingKiraMove: string | null = null;

export function setChessMoveResolver(resolve: ((move: string | null) => void) | null) {
  pendingChessMoveResolve = resolve;
}
export function setLastChessCommandId(id: string | null) { lastChessCommandId = id; }
export function getLastChessMessage() { return lastChessMessage; }
export function consumePendingKiraMove(): string | null {
  const move = pendingKiraMove;
  pendingKiraMove = null;
  return move;
}

function deliverChessMove(move: string, message?: string) {
  lastChessMessage = message || "Your turn.";
  if (pendingChessMoveResolve) {
    pendingChessMoveResolve(move);
    pendingChessMoveResolve = null;
  } else {
    pendingKiraMove = move;
  }
  lastChessCommandId = null;
}

async function recoverMissedChessMove() {
  if (!lastChessCommandId) return;
  try {
    const { data } = await supabase
      .from("device_commands")
      .select("*")
      .eq("id", lastChessCommandId)
      .single();
    if (data?.status === "complete" && data?.result?.move) {
      deliverChessMove(data.result.move, data.result.message);
    }
  } catch {}
}

// --- Screen definitions ---
type ScreenName = "home" | "chat" | "controls" | "alerts" | "chess" | "conference";

const SCREENS: { name: ScreenName; icon: string }[] = [
  { name: "home", icon: "⬡" },
  { name: "chat", icon: "◬" },
  { name: "conference", icon: "◈" },
  { name: "controls", icon: "⊞" },
  { name: "alerts", icon: "△" },
  { name: "chess", icon: "♟" },
];

function NavBar({
  current,
  onNavigate,
}: {
  current: ScreenName;
  onNavigate: (screen: ScreenName) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.navBar, { paddingBottom: insets.bottom + 8 }]}>
      {SCREENS.map((s) => (
        <Pressable
          key={s.name}
          style={styles.navItem}
          onPress={() => onNavigate(s.name)}
          hitSlop={8}
        >
          <View style={[styles.navIcon, current === s.name && styles.navIconActive]}>
            <Animated.Text
              style={[
                styles.navIconText,
                { color: current === s.name ? Colors.primary : Colors.textFaint },
              ]}
            >
              {s.icon}
            </Animated.Text>
          </View>
          {current === s.name && <View style={styles.navDot} />}
        </Pressable>
      ))}
    </View>
  );
}

function AppContent() {
  const [screen, setScreen] = useState<ScreenName>("home");
  const [prevScreen, setPrevScreen] = useState<ScreenName | null>(null);
  const [callScreenVisible, setCallScreenVisible] = useState(false);
  const transitionAnim = useRef(new Animated.Value(1)).current;
  const transitioning = useRef(false);

  // Wire the module-level call-screen toggle (so any component can open the call overlay)
  useEffect(() => {
    setCallScreenVisibleRef = setCallScreenVisible;
    return () => { setCallScreenVisibleRef = null; };
  }, []);

  // Hide Android system navigation bar — immersive mode
  useEffect(() => {
    NavigationBar.setVisibilityAsync("hidden").catch(() => {});
    NavigationBar.setBehaviorAsync("overlay-swipe").catch(() => {});
    NavigationBar.setBackgroundColorAsync(Colors.surfaceLow).catch(() => {});
  }, []);

  // Chess move realtime listener (app-level)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") recoverMissedChessMove();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("chess-app-level")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "device_commands" },
        (payload: any) => {
          const updated = payload.new;
          if (
            updated.command_type === "chess_move_request" &&
            updated.status === "complete" &&
            updated.result?.move
          ) {
            deliverChessMove(updated.result.move, updated.result.message);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const navigate = useCallback((to: ScreenName) => {
    if (to === screen || transitioning.current) return;
    transitioning.current = true;
    setPrevScreen(screen);

    // Fade out
    Animated.timing(transitionAnim, {
      toValue: 0,
      duration: TRANSITION_DURATION * 0.4,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setScreen(to);
      // Fade in
      Animated.timing(transitionAnim, {
        toValue: 1,
        duration: TRANSITION_DURATION * 0.6,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        transitioning.current = false;
        setPrevScreen(null);
      });
    });
  }, [screen, transitionAnim]);

  const renderScreen = () => {
    switch (screen) {
      case "home": return <HomeScreen />;
      case "chat": return <ChatScreen />;
      case "controls": return <ControlsScreen />;
      case "alerts": return <AlertsScreen />;
      case "chess": return <ChessScreen onClose={() => navigate("chat")} />;
      case "conference": return <ConferenceScreen />;
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.bg} />
      <Animated.View
        style={[
          styles.screenContainer,
          {
            opacity: transitionAnim,
            transform: [
              {
                translateY: transitionAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [12, 0],
                }),
              },
            ],
          },
        ]}
      >
        {renderScreen()}
      </Animated.View>
      <NavBar current={screen} onNavigate={navigate} />
      {callScreenVisible && (
        <View style={StyleSheet.absoluteFill}>
          <CallKiraScreen onClose={() => setCallScreenVisible(false)} />
        </View>
      )}
    </View>
  );
}

export default Sentry.wrap(function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  screenContainer: {
    flex: 1,
  },
  // Navigation bar
  navBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingTop: 12,
    backgroundColor: Colors.surfaceLow,
    borderTopWidth: 0,
  },
  navItem: {
    alignItems: "center",
    gap: 4,
  },
  navIcon: {
    width: 44,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  navIconActive: {},
  navIconText: {
    fontSize: NAV_ICON_SIZE,
  },
  navDot: {
    width: 4,
    height: 2,
    backgroundColor: Colors.primary,
  },
});
