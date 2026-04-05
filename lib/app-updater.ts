/**
 * Self-hosted OTA update checker for Kira app.
 *
 * On launch, checks Supabase for a newer version.
 * If found, downloads the APK and prompts to install.
 * No expo-updates dependency — just Supabase Storage + a version table.
 */

import { Alert, Linking } from "react-native";

// Current app version tag — update this on each release
export const CURRENT_VERSION = "v1.0.1775407144";

const BACKEND_URL = "https://kira-backend-six.vercel.app";

export async function checkForAppUpdate(silent: boolean = true): Promise<void> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/kira/app-version`);
    if (!res.ok) {
      if (!silent) Alert.alert("Update check failed", `Server returned ${res.status}`);
      return;
    }

    const data = await res.json();
    if (!data.version || data.version === CURRENT_VERSION) {
      if (!silent) Alert.alert("Up to date", `Build: ${CURRENT_VERSION.replace("v1.0.", "")}`);
      return;
    }

    if (!data.url) {
      if (!silent) Alert.alert("Update available", `${data.version} — connect USB to install`);
      return;
    }

    Alert.alert(
      `Update: ${data.version}`,
      data.notes || "A new version of Kira is available.",
      [
        { text: "Later", style: "cancel" },
        {
          text: "Download",
          onPress: () => Linking.openURL(data.url),
        },
      ]
    );
  } catch (e: any) {
    if (!silent) Alert.alert("Update check failed", e?.message || "Network error");
    console.log("[Updater] Check failed:", e);
  }
}
