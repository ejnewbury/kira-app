package com.vallaryn.kira.accessibility

import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.text.TextUtils
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap

class KiraAccessibilityModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "KiraAccessibility"

    @ReactMethod
    fun isServiceEnabled(promise: Promise) {
        try {
            val context = reactApplicationContext
            val serviceName = "${context.packageName}/${KiraAccessibilityService::class.java.canonicalName}"
            val enabledServices = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: ""
            val isEnabled = enabledServices.split(':').any {
                it.equals(serviceName, ignoreCase = true)
            }
            promise.resolve(isEnabled)
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to check accessibility service status", e)
        }
    }

    @ReactMethod
    fun openAccessibilitySettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactApplicationContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to open accessibility settings", e)
        }
    }

    @ReactMethod
    fun setApiKey(key: String, promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("kira_prefs", Context.MODE_PRIVATE)
            prefs.edit().putString("api_key", key).apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to set API key", e)
        }
    }

    @ReactMethod
    fun getServiceStatus(promise: Promise) {
        try {
            val map = WritableNativeMap()
            val instance = KiraAccessibilityService.instance
            map.putBoolean("connected", instance != null)

            val context = reactApplicationContext
            val serviceName = "${context.packageName}/${KiraAccessibilityService::class.java.canonicalName}"
            val enabledServices = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: ""
            val isEnabled = enabledServices.split(':').any {
                it.equals(serviceName, ignoreCase = true)
            }
            map.putBoolean("enabled", isEnabled)

            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to get service status", e)
        }
    }
}
