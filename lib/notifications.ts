/**
 * Push notification registration for Kira app.
 *
 * Registers for Expo push notifications and saves the token
 * to Supabase so the backend can send notifications when
 * Kira (terminal) responds.
 */

import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { supabase } from "./supabase";

// Silence notifications when app is in foreground (user is already looking at it)
// Doorbell alerts always show regardless
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const isDoorbell = notification.request.content.data?.type === "doorbell";
    return {
      shouldShowAlert: isDoorbell,    // only show banner for doorbell when foregrounded
      shouldPlaySound: isDoorbell,    // only play sound for doorbell when foregrounded
      shouldSetBadge: false,
      shouldShowBanner: isDoorbell,
      shouldShowList: true,           // always add to notification list
    };
  },
});

/**
 * Register for push notifications and save token to Supabase.
 * Call this once on app startup.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log("[Notifications] Must use physical device for push notifications");
    return null;
  }

  // Check/request permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.log("[Notifications] Permission not granted");
    return null;
  }

  // Android notification channel
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("kira", {
      name: "Kira Messages",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#2A9D8F",
      sound: "default",
    });

    // Doorbell alerts — max priority, breaks through DND
    await Notifications.setNotificationChannelAsync("doorbell", {
      name: "Doorbell & Security",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 200, 500],
      lightColor: "#FF4444",
      sound: "default",
      bypassDnd: true,
    });
  }

  // Get Expo push token
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: "657bbb94-4198-462b-b781-8fb4b8ba4fe0",
    });
    const token = tokenData.data;
    console.log("[Notifications] Push token:", token);

    // Save to Supabase — upsert so we always have the latest token
    await supabase
      .from("kira_push_tokens")
      .upsert(
        { device_id: Device.modelId || "unknown", token, platform: Platform.OS, updated_at: new Date().toISOString() },
        { onConflict: "device_id" }
      );

    return token;
  } catch (error: any) {
    // Only log once, not on every retry — Firebase not configured yet
    if (!error?.message?.includes("FirebaseApp")) {
      console.warn("[Notifications] Push token error:", error?.message);
    }
    return null;
  }
}
