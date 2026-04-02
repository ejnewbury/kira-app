package com.vallaryn.kira.accessibility

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class CommandPoller(private val service: KiraAccessibilityService) {

    companion object {
        private const val TAG = "KiraCommandPoller"
        private const val BASE_URL = "https://kira-backend-six.vercel.app/api/kira/device-command"
        private const val POLL_INTERVAL_MS = 2000L
        private const val DEFAULT_API_KEY = "ee35a1f1ea15d2ca456089e562a296382511246a28250de47b82520edae92c14"

        // Rate limiting
        private const val RATE_LIMIT_WINDOW_MS = 5000L
        private const val RATE_LIMIT_MAX_COMMANDS = 10

        // Sensitive app blocklist for screen reading
        private val SENSITIVE_APPS = setOf(
            "com.chase.sig.android",
            "com.bankofamerica.cashpromobile",
            "com.venmo",
            "com.paypal.android.p2pmobile",
            "com.agilebits.onepassword",
            "com.lastpass.lpandroid",
            "com.x8bit.bitwarden",
            "com.google.android.apps.authenticator2",
            "com.authy.authy",
            "com.twilio.authy"
        )
    }

    private val executor = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()

    @Volatile
    private var running = false

    private val commandTimestamps = mutableListOf<Long>()

    fun start() {
        if (running) return
        running = true
        Log.i(TAG, "Command poller started")
        scheduleNext()
    }

    fun stop() {
        running = false
        Log.i(TAG, "Command poller stopped")
    }

    private fun scheduleNext() {
        if (!running) return
        handler.postDelayed({
            if (running) {
                executor.execute { pollAndExecute() }
            }
        }, POLL_INTERVAL_MS)
    }

    private fun getApiKey(): String {
        return try {
            val prefs = service.getSharedPreferences("kira_prefs", Context.MODE_PRIVATE)
            prefs.getString("api_key", null) ?: DEFAULT_API_KEY
        } catch (e: Exception) {
            DEFAULT_API_KEY
        }
    }

    private fun pollAndExecute() {
        try {
            // Rate limiting check
            val now = System.currentTimeMillis()
            commandTimestamps.removeAll { now - it > RATE_LIMIT_WINDOW_MS }
            if (commandTimestamps.size >= RATE_LIMIT_MAX_COMMANDS) {
                Log.e(TAG, "Rate limit exceeded! Disabling service for safety.")
                stop()
                return
            }

            val request = Request.Builder()
                .url("$BASE_URL?status=pending")
                .addHeader("X-Kira-Api-Key", getApiKey())
                .get()
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: return

            if (!response.isSuccessful) {
                Log.w(TAG, "Poll failed: ${response.code}")
                scheduleNext()
                return
            }

            val json = JSONObject(body)
            if (!json.has("command") || json.isNull("command")) {
                scheduleNext()
                return
            }

            val command = json.getJSONObject("command")
            val commandId = command.getString("id")
            val commandType = command.getString("type")
            val params = command.optJSONObject("params") ?: JSONObject()

            Log.i(TAG, "Executing command: $commandType (id=$commandId)")
            commandTimestamps.add(System.currentTimeMillis())

            // Check sensitive app blocklist for screen-reading commands
            if (commandType in listOf("read_screen", "screenshot", "find_element")) {
                val activePackage = try {
                    service.rootInActiveWindow?.packageName?.toString() ?: ""
                } catch (e: Exception) { "" }
                if (SENSITIVE_APPS.any { activePackage.contains(it, ignoreCase = true) }) {
                    reportResult(commandId, JSONObject().apply {
                        put("success", false)
                        put("error", "Blocked: sensitive app detected ($activePackage)")
                    })
                    scheduleNext()
                    return
                }
            }

            val result = service.executeCommand(commandType, params)
            reportResult(commandId, result)

        } catch (e: Exception) {
            Log.e(TAG, "Poll error", e)
        }
        scheduleNext()
    }

    private fun reportResult(commandId: String, result: JSONObject) {
        try {
            val payload = JSONObject()
            payload.put("id", commandId)
            payload.put("status", if (result.optBoolean("success", false)) "completed" else "failed")
            payload.put("result", result)

            val mediaType = "application/json; charset=utf-8".toMediaType()
            val requestBody = payload.toString().toRequestBody(mediaType)

            val request = Request.Builder()
                .url(BASE_URL)
                .addHeader("X-Kira-Api-Key", getApiKey())
                .patch(requestBody)
                .build()

            val response = client.newCall(request).execute()
            response.close()

            if (!response.isSuccessful) {
                Log.w(TAG, "Report result failed: ${response.code}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error reporting result", e)
        }
    }
}
