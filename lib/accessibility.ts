import { NativeModules, Platform } from "react-native";

const KiraAccessibility =
  Platform.OS === "android" ? NativeModules.KiraAccessibility : null;

export async function isAccessibilityServiceEnabled(): Promise<boolean> {
  if (!KiraAccessibility) return false;
  try {
    return await KiraAccessibility.isServiceEnabled();
  } catch {
    return false;
  }
}

export function openAccessibilitySettings(): void {
  KiraAccessibility?.openAccessibilitySettings();
}

export async function setApiKey(key: string): Promise<boolean> {
  if (!KiraAccessibility) return false;
  try {
    return await KiraAccessibility.setApiKey(key);
  } catch {
    return false;
  }
}

export async function getServiceStatus(): Promise<{
  connected: boolean;
  enabled: boolean;
}> {
  if (!KiraAccessibility) return { connected: false, enabled: false };
  try {
    return await KiraAccessibility.getServiceStatus();
  } catch {
    return { connected: false, enabled: false };
  }
}
