package com.vallaryn.kira.accessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

class KiraAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "KiraAccessibility"
        var instance: KiraAccessibilityService? = null
            private set
    }

    private var commandPoller: CommandPoller? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "Accessibility service connected")
        commandPoller = CommandPoller(this)
        commandPoller?.start()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Events handled on-demand via command polling
    }

    override fun onInterrupt() {
        Log.w(TAG, "Accessibility service interrupted")
    }

    override fun onDestroy() {
        super.onDestroy()
        commandPoller?.stop()
        commandPoller = null
        instance = null
        Log.i(TAG, "Accessibility service destroyed")
    }

    fun executeCommand(type: String, params: JSONObject): JSONObject {
        val result = JSONObject()
        try {
            when (type) {
                "read_screen" -> readScreen(params, result)
                "tap" -> tap(params, result)
                "long_press" -> longPress(params, result)
                "swipe" -> swipe(params, result)
                "scroll" -> scroll(params, result)
                "type_text" -> typeText(params, result)
                "press_key" -> pressKey(params, result)
                "open_app" -> openApp(params, result)
                "screenshot" -> takeScreenshotCommand(params, result)
                "get_device_info" -> getDeviceInfo(result)
                "get_location" -> getLocation(result)
                "find_element" -> findElement(params, result)
                "clipboard_get" -> clipboardGet(result)
                "clipboard_set" -> clipboardSet(params, result)
                "file_send" -> fileReceiveFromBackend(params, result)
                "file_pull" -> fileSendToBackend(params, result)
                "file_list" -> fileList(params, result)
                "kill_switch" -> killSwitch(result)
                else -> {
                    result.put("success", false)
                    result.put("error", "Unknown command: $type")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error executing command: $type", e)
            result.put("success", false)
            result.put("error", e.message ?: "Unknown error")
        }
        return result
    }

    // ---- read_screen ----

    private fun readScreen(params: JSONObject, result: JSONObject) {
        val maxDepth = params.optInt("max_depth", 15)
        val rootNode = rootInActiveWindow
        if (rootNode == null) {
            result.put("success", false)
            result.put("error", "No active window")
            return
        }
        val nodes = JSONArray()
        walkTree(rootNode, nodes, 0, maxDepth, null)
        rootNode.recycle()
        result.put("success", true)
        result.put("nodes", nodes)
        result.put("count", nodes.length())
    }

    private fun walkTree(
        node: AccessibilityNodeInfo,
        out: JSONArray,
        depth: Int,
        maxDepth: Int,
        parentId: String?
    ) {
        if (depth > maxDepth) return
        val nodeId = "${node.hashCode()}"
        val obj = JSONObject()
        obj.put("id", nodeId)
        obj.put("class_name", node.className?.toString() ?: "")
        obj.put("text", node.text?.toString() ?: "")
        obj.put("content_desc", node.contentDescription?.toString() ?: "")
        obj.put("resource_id", node.viewIdResourceName ?: "")
        val rect = Rect()
        node.getBoundsInScreen(rect)
        obj.put("bounds", JSONObject().apply {
            put("left", rect.left)
            put("top", rect.top)
            put("right", rect.right)
            put("bottom", rect.bottom)
        })
        obj.put("clickable", node.isClickable)
        obj.put("scrollable", node.isScrollable)
        obj.put("editable", node.isEditable)
        obj.put("focused", node.isFocused)
        obj.put("checked", node.isChecked)
        obj.put("parent_id", parentId ?: "")
        obj.put("depth", depth)
        out.put(obj)

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            walkTree(child, out, depth + 1, maxDepth, nodeId)
            child.recycle()
        }
    }

    // ---- tap ----

    private fun tap(params: JSONObject, result: JSONObject) {
        if (params.has("text")) {
            val text = params.getString("text")
            val node = findNodeByText(rootInActiveWindow, text)
            if (node != null) {
                val rect = Rect()
                node.getBoundsInScreen(rect)
                val x = rect.centerX().toFloat()
                val y = rect.centerY().toFloat()
                node.recycle()
                performTap(x, y, result)
            } else {
                result.put("success", false)
                result.put("error", "Element with text '$text' not found")
            }
        } else {
            val x = params.getDouble("x").toFloat()
            val y = params.getDouble("y").toFloat()
            performTap(x, y, result)
        }
    }

    private fun performTap(x: Float, y: Float, result: JSONObject) {
        val path = Path()
        path.moveTo(x, y)
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 100))
            .build()
        dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                result.put("success", true)
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                result.put("success", false)
                result.put("error", "Tap gesture cancelled")
            }
        }, null)
        // Give gesture time to complete
        Thread.sleep(300)
        if (!result.has("success")) {
            result.put("success", true)
        }
    }

    // ---- long_press ----

    private fun longPress(params: JSONObject, result: JSONObject) {
        val x = params.getDouble("x").toFloat()
        val y = params.getDouble("y").toFloat()
        val duration = params.optLong("duration", 1000)
        val path = Path()
        path.moveTo(x, y)
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, duration))
            .build()
        dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                result.put("success", true)
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                result.put("success", false)
                result.put("error", "Long press cancelled")
            }
        }, null)
        Thread.sleep(duration + 200)
        if (!result.has("success")) {
            result.put("success", true)
        }
    }

    // ---- swipe ----

    private fun swipe(params: JSONObject, result: JSONObject) {
        val startX = params.getDouble("startX").toFloat()
        val startY = params.getDouble("startY").toFloat()
        val endX = params.getDouble("endX").toFloat()
        val endY = params.getDouble("endY").toFloat()
        val duration = params.optLong("duration", 500)
        val path = Path()
        path.moveTo(startX, startY)
        path.lineTo(endX, endY)
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, duration))
            .build()
        dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                result.put("success", true)
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                result.put("success", false)
                result.put("error", "Swipe cancelled")
            }
        }, null)
        Thread.sleep(duration + 200)
        if (!result.has("success")) {
            result.put("success", true)
        }
    }

    // ---- scroll ----

    private fun scroll(params: JSONObject, result: JSONObject) {
        val direction = params.optString("direction", "down")
        val metrics = getScreenMetrics()
        val screenWidth = metrics.widthPixels
        val screenHeight = metrics.heightPixels
        val centerX = screenWidth / 2f
        val centerY = screenHeight / 2f
        val distance = screenHeight / 3f

        val (startX, startY, endX, endY) = when (direction) {
            "up" -> arrayOf(centerX, centerY - distance / 2, centerX, centerY + distance / 2)
            "down" -> arrayOf(centerX, centerY + distance / 2, centerX, centerY - distance / 2)
            "left" -> arrayOf(centerX - distance / 2, centerY, centerX + distance / 2, centerY)
            "right" -> arrayOf(centerX + distance / 2, centerY, centerX - distance / 2, centerY)
            else -> {
                result.put("success", false)
                result.put("error", "Invalid direction: $direction")
                return
            }
        }
        val path = Path()
        path.moveTo(startX, startY)
        path.lineTo(endX, endY)
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 400))
            .build()
        dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                result.put("success", true)
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                result.put("success", false)
                result.put("error", "Scroll cancelled")
            }
        }, null)
        Thread.sleep(600)
        if (!result.has("success")) {
            result.put("success", true)
        }
    }

    // ---- type_text ----

    private fun typeText(params: JSONObject, result: JSONObject) {
        val text = params.getString("text")
        val clear = params.optBoolean("clear", false)
        val rootNode = rootInActiveWindow
        if (rootNode == null) {
            result.put("success", false)
            result.put("error", "No active window")
            return
        }
        val focusedNode = findFocusedEditableNode(rootNode)
        if (focusedNode == null) {
            rootNode.recycle()
            result.put("success", false)
            result.put("error", "No focused editable field found")
            return
        }
        if (clear) {
            val clearArgs = Bundle()
            clearArgs.putCharSequence(
                AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, ""
            )
            focusedNode.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, clearArgs)
            Thread.sleep(100)
        }
        val args = Bundle()
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        val success = focusedNode.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        focusedNode.recycle()
        rootNode.recycle()
        result.put("success", success)
    }

    private fun findFocusedEditableNode(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (node.isFocused && node.isEditable) return AccessibilityNodeInfo.obtain(node)
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findFocusedEditableNode(child)
            child.recycle()
            if (found != null) return found
        }
        return null
    }

    // ---- press_key ----

    private fun pressKey(params: JSONObject, result: JSONObject) {
        val key = params.getString("key").lowercase()
        val action = when (key) {
            "back" -> GLOBAL_ACTION_BACK
            "home" -> GLOBAL_ACTION_HOME
            "recents" -> GLOBAL_ACTION_RECENTS
            "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
            else -> {
                result.put("success", false)
                result.put("error", "Unknown key: $key")
                return
            }
        }
        val success = performGlobalAction(action)
        result.put("success", success)
    }

    // ---- open_app ----

    private fun openApp(params: JSONObject, result: JSONObject) {
        val packageName = params.getString("package_name")
        val intent = packageManager.getLaunchIntentForPackage(packageName)
        if (intent != null) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
            result.put("success", true)
        } else {
            result.put("success", false)
            result.put("error", "App not found: $packageName")
        }
    }

    // ---- screenshot ----

    private fun takeScreenshotCommand(params: JSONObject, result: JSONObject) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            result.put("success", false)
            result.put("error", "Screenshot requires API 30+")
            return
        }
        val latch = java.util.concurrent.CountDownLatch(1)
        takeScreenshot(
            android.view.Display.DEFAULT_DISPLAY,
            mainExecutor,
            object : TakeScreenshotCallback {
                override fun onSuccess(screenshotResult: ScreenshotResult) {
                    try {
                        val bitmap = Bitmap.wrapHardwareBuffer(
                            screenshotResult.hardwareBuffer,
                            screenshotResult.colorSpace
                        )
                        if (bitmap != null) {
                            val stream = ByteArrayOutputStream()
                            bitmap.compress(Bitmap.CompressFormat.JPEG, 80, stream)
                            val base64 = Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
                            result.put("success", true)
                            result.put("image", base64)
                            result.put("format", "jpeg")
                        } else {
                            result.put("success", false)
                            result.put("error", "Failed to create bitmap from screenshot")
                        }
                        screenshotResult.hardwareBuffer.close()
                    } catch (e: Exception) {
                        result.put("success", false)
                        result.put("error", "Screenshot processing error: ${e.message}")
                    }
                    latch.countDown()
                }

                override fun onFailure(errorCode: Int) {
                    result.put("success", false)
                    result.put("error", "Screenshot failed with code: $errorCode")
                    latch.countDown()
                }
            }
        )
        latch.await(5, java.util.concurrent.TimeUnit.SECONDS)
        if (!result.has("success")) {
            result.put("success", false)
            result.put("error", "Screenshot timed out")
        }
    }

    // ---- get_device_info ----

    private fun getDeviceInfo(result: JSONObject) {
        val metrics = getScreenMetrics()
        val activePackage = rootInActiveWindow?.packageName?.toString() ?: "unknown"
        result.put("success", true)
        result.put("model", Build.MODEL)
        result.put("manufacturer", Build.MANUFACTURER)
        result.put("sdk", Build.VERSION.SDK_INT)
        result.put("screen_width", metrics.widthPixels)
        result.put("screen_height", metrics.heightPixels)
        result.put("active_app", activePackage)
    }

    // ---- get_location ----

    @Suppress("MissingPermission")
    private fun getLocation(result: JSONObject) {
        try {
            val locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
            var location = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER)
            if (location == null) {
                location = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
            }
            if (location != null) {
                result.put("success", true)
                result.put("latitude", location.latitude)
                result.put("longitude", location.longitude)
                result.put("accuracy", location.accuracy)
                result.put("provider", location.provider)
            } else {
                result.put("success", false)
                result.put("error", "No location available")
            }
        } catch (e: SecurityException) {
            result.put("success", false)
            result.put("error", "Location permission denied: ${e.message}")
        }
    }

    // ---- find_element ----

    private fun findElement(params: JSONObject, result: JSONObject) {
        val rootNode = rootInActiveWindow
        if (rootNode == null) {
            result.put("success", false)
            result.put("error", "No active window")
            return
        }
        val matches = JSONArray()
        if (params.has("text")) {
            val text = params.getString("text")
            findNodesByText(rootNode, text, matches)
        } else if (params.has("resource_id")) {
            val resourceId = params.getString("resource_id")
            findNodesByResourceId(rootNode, resourceId, matches)
        }
        rootNode.recycle()
        result.put("success", true)
        result.put("elements", matches)
        result.put("count", matches.length())
    }

    private fun findNodesByText(node: AccessibilityNodeInfo, text: String, out: JSONArray) {
        val nodeText = node.text?.toString() ?: ""
        val contentDesc = node.contentDescription?.toString() ?: ""
        if (nodeText.contains(text, ignoreCase = true) || contentDesc.contains(text, ignoreCase = true)) {
            val rect = Rect()
            node.getBoundsInScreen(rect)
            out.put(JSONObject().apply {
                put("text", nodeText)
                put("content_desc", contentDesc)
                put("resource_id", node.viewIdResourceName ?: "")
                put("class_name", node.className?.toString() ?: "")
                put("bounds", JSONObject().apply {
                    put("left", rect.left)
                    put("top", rect.top)
                    put("right", rect.right)
                    put("bottom", rect.bottom)
                })
                put("clickable", node.isClickable)
            })
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            findNodesByText(child, text, out)
            child.recycle()
        }
    }

    private fun findNodesByResourceId(node: AccessibilityNodeInfo, resourceId: String, out: JSONArray) {
        val nodeResId = node.viewIdResourceName ?: ""
        if (nodeResId.contains(resourceId, ignoreCase = true)) {
            val rect = Rect()
            node.getBoundsInScreen(rect)
            out.put(JSONObject().apply {
                put("text", node.text?.toString() ?: "")
                put("content_desc", node.contentDescription?.toString() ?: "")
                put("resource_id", nodeResId)
                put("class_name", node.className?.toString() ?: "")
                put("bounds", JSONObject().apply {
                    put("left", rect.left)
                    put("top", rect.top)
                    put("right", rect.right)
                    put("bottom", rect.bottom)
                })
                put("clickable", node.isClickable)
            })
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            findNodesByResourceId(child, resourceId, out)
            child.recycle()
        }
    }

    // ---- clipboard ----

    private fun clipboardGet(result: JSONObject) {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = clipboard.primaryClip
        if (clip != null && clip.itemCount > 0) {
            result.put("success", true)
            result.put("text", clip.getItemAt(0).text?.toString() ?: "")
        } else {
            result.put("success", true)
            result.put("text", "")
        }
    }

    private fun clipboardSet(params: JSONObject, result: JSONObject) {
        val text = params.getString("text")
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = ClipData.newPlainText("Kira", text)
        clipboard.setPrimaryClip(clip)
        result.put("success", true)
    }

    // ---- file operations ----

    private fun fileReceiveFromBackend(params: JSONObject, result: JSONObject) {
        val fileName = params.getString("file_name")
        val dir = File("/sdcard/Kira Transfer")
        if (!dir.exists()) dir.mkdirs()
        val outFile = File(dir, fileName)

        if (params.has("data")) {
            // Base64 data
            val data = Base64.decode(params.getString("data"), Base64.DEFAULT)
            FileOutputStream(outFile).use { it.write(data) }
            result.put("success", true)
            result.put("path", outFile.absolutePath)
        } else if (params.has("url")) {
            // Download from URL
            try {
                val url = java.net.URL(params.getString("url"))
                val connection = url.openConnection()
                connection.connectTimeout = 15000
                connection.readTimeout = 15000
                connection.getInputStream().use { input ->
                    FileOutputStream(outFile).use { output ->
                        input.copyTo(output)
                    }
                }
                result.put("success", true)
                result.put("path", outFile.absolutePath)
            } catch (e: Exception) {
                result.put("success", false)
                result.put("error", "Download failed: ${e.message}")
            }
        } else {
            result.put("success", false)
            result.put("error", "No data or url provided")
        }
    }

    private fun fileSendToBackend(params: JSONObject, result: JSONObject) {
        val filePath = params.getString("path")
        val file = File(filePath)
        if (!file.exists()) {
            result.put("success", false)
            result.put("error", "File not found: $filePath")
            return
        }
        val maxSize = 2 * 1024 * 1024 // 2MB
        if (file.length() > maxSize) {
            result.put("success", false)
            result.put("error", "File too large (max 2MB): ${file.length()} bytes")
            return
        }
        val bytes = FileInputStream(file).use { it.readBytes() }
        val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
        result.put("success", true)
        result.put("data", base64)
        result.put("file_name", file.name)
        result.put("size", file.length())
    }

    private fun fileList(params: JSONObject, result: JSONObject) {
        val dirPath = params.optString("path", "/sdcard/Kira Transfer")
        val dir = File(dirPath)
        if (!dir.exists() || !dir.isDirectory) {
            result.put("success", false)
            result.put("error", "Directory not found: $dirPath")
            return
        }
        val files = JSONArray()
        dir.listFiles()?.forEach { file ->
            files.put(JSONObject().apply {
                put("name", file.name)
                put("path", file.absolutePath)
                put("is_directory", file.isDirectory)
                put("size", file.length())
                put("last_modified", file.lastModified())
            })
        }
        result.put("success", true)
        result.put("files", files)
        result.put("count", files.length())
    }

    // ---- kill_switch ----

    private fun killSwitch(result: JSONObject) {
        commandPoller?.stop()
        commandPoller = null
        result.put("success", true)
        result.put("message", "Service disabled")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            disableSelf()
        }
    }

    // ---- helpers ----

    private fun findNodeByText(root: AccessibilityNodeInfo?, text: String): AccessibilityNodeInfo? {
        if (root == null) return null
        val nodeText = root.text?.toString() ?: ""
        val contentDesc = root.contentDescription?.toString() ?: ""
        if (nodeText.contains(text, ignoreCase = true) || contentDesc.contains(text, ignoreCase = true)) {
            return AccessibilityNodeInfo.obtain(root)
        }
        for (i in 0 until root.childCount) {
            val child = root.getChild(i) ?: continue
            val found = findNodeByText(child, text)
            if (found != null) {
                child.recycle()
                return found
            }
            child.recycle()
        }
        return null
    }

    private fun getScreenMetrics(): DisplayMetrics {
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(metrics)
        return metrics
    }
}
