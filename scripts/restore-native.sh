#!/bin/bash
# Restore native Kotlin files after expo prebuild --clean
# Run this AFTER prebuild if the android/ directory was regenerated

KIRA_APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NATIVE_SRC="$KIRA_APP_DIR/native-src"
ANDROID_DIR="$KIRA_APP_DIR/android/app/src/main"

echo "Restoring native files from native-src/..."

# Accessibility service Kotlin files
mkdir -p "$ANDROID_DIR/java/com/vallaryn/kira/accessibility"
cp "$NATIVE_SRC/accessibility/"*.kt "$ANDROID_DIR/java/com/vallaryn/kira/accessibility/"
echo "  ✓ Kotlin files copied"

# XML config
mkdir -p "$ANDROID_DIR/res/xml"
cp "$NATIVE_SRC/res/xml/"*.xml "$ANDROID_DIR/res/xml/"
echo "  ✓ XML config copied"

# Re-add accessibility string to strings.xml if missing
if ! grep -q "accessibility_service_description" "$ANDROID_DIR/res/values/strings.xml" 2>/dev/null; then
    sed -i 's|</resources>|  <string name="accessibility_service_description">Allows Kira AI assistant to read screen content and perform actions remotely for hands-free phone control.</string>\n</resources>|' "$ANDROID_DIR/res/values/strings.xml"
    echo "  ✓ Accessibility string added"
fi

# Re-add accessibility service to AndroidManifest.xml if missing
if ! grep -q "KiraAccessibilityService" "$ANDROID_DIR/AndroidManifest.xml" 2>/dev/null; then
    sed -i 's|</application>|    <service\n        android:name=".accessibility.KiraAccessibilityService"\n        android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"\n        android:exported="false">\n      <intent-filter>\n        <action android:name="android.accessibilityservice.AccessibilityService"/>\n      </intent-filter>\n      <meta-data\n          android:name="android.accessibilityservice"\n          android:resource="@xml/accessibility_service_config"/>\n    </service>\n  </application>|' "$ANDROID_DIR/AndroidManifest.xml"
    echo "  ✓ Accessibility service added to manifest"
fi

# Re-add package to MainApplication.kt if missing
if ! grep -q "KiraAccessibilityPackage" "$ANDROID_DIR/java/com/vallaryn/kira/MainApplication.kt" 2>/dev/null; then
    sed -i 's|PackageList(this).packages.apply {|PackageList(this).packages.apply {\n          add(com.vallaryn.kira.accessibility.KiraAccessibilityPackage())|' "$ANDROID_DIR/java/com/vallaryn/kira/MainApplication.kt"
    echo "  ✓ Package registration added to MainApplication"
fi

# Re-add permissions if missing
if ! grep -q "ACCESS_FINE_LOCATION" "$ANDROID_DIR/AndroidManifest.xml" 2>/dev/null; then
    sed -i '/<uses-permission android:name="android.permission.VIBRATE"\/>/a\  <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"\/>\n  <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"\/>\n  <uses-permission android:name="android.permission.FOREGROUND_SERVICE"\/>\n  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE"\/>\n  <uses-permission android:name="android.permission.QUERY_ALL_PACKAGES"\/>' "$ANDROID_DIR/AndroidManifest.xml"
    echo "  ✓ Permissions added to manifest"
fi

echo "Done! Native files restored."
