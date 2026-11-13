package ph.edu.wmsu.arenahub.companion

import android.Manifest
import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * Collects the facts the server turns into signals. The format must match androidFactsSchema in
 * src/lib/integrityRisk.ts. Nothing here touches the game itself: it only describes the phone around it.
 *
 * To keep the phone smooth, the expensive part (walking every installed app) runs at most once a
 * minute, or straight away when an app is installed, updated or removed. Cheap settings checks run
 * on every report.
 */
class DeviceChecks(private val context: Context) {
    private val pm = context.packageManager
    private var heavyAt = 0L
    private var heavyKey = ""
    private var heavy: Heavy? = null

    private class Heavy(val games: JSONArray, val flagged: List<String>, val overlays: List<String>)

    /** Called when apps change, so the next report rescans. */
    @Synchronized fun invalidate() { heavy = null }

    @Synchronized
    fun collect(gamePackages: List<String>, blockedPatterns: List<String>, recording: Boolean, recordingRefused: Boolean): JSONObject {
        val key = (gamePackages + "|" + blockedPatterns).joinToString(",")
        val now = SystemClock.elapsedRealtime()
        val scan = heavy?.takeIf { key == heavyKey && now - heavyAt < HEAVY_EVERY_MS } ?: scanApps(gamePackages, blockedPatterns).also { heavy = it; heavyAt = now; heavyKey = key }
        return JSONObject()
            .put("platform", "android")
            .put("games", scan.games)
            .put("installedFlagged", JSONArray(scan.flagged))
            .put("rootIndicators", JSONArray(rootIndicators()))
            .put("emulatorIndicators", JSONArray(emulatorIndicators()))
            .put("accessibilityServices", JSONArray(accessibilityServices()))
            .put("overlayPackages", JSONArray(scan.overlays))
            .put("developerOptions", globalFlag(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED))
            .put("usbDebugging", globalFlag(Settings.Global.ADB_ENABLED) || globalFlag("adb_wifi_enabled"))
            .put("recording", recording)
            .put("recordingRefused", recordingRefused)
            .apply { foregroundPackage()?.let { put("foregroundPackage", it) } }
    }

    private fun scanApps(gamePackages: List<String>, blockedPatterns: List<String>): Heavy {
        val installed = pm.getInstalledApplications(0)
        return Heavy(
            JSONArray(gamePackages.mapNotNull { gameInfo(it) }),
            installed.map { it.packageName }.filter { matchesAny(it, blockedPatterns) }.take(100),
            overlayPackages(installed),
        )
    }

    /** Trailing * matches a prefix, otherwise the name must match exactly (case-insensitive). */
    private fun matchesAny(name: String, patterns: List<String>): Boolean {
        val value = name.lowercase()
        return patterns.any { p -> if (p.endsWith("*")) value.startsWith(p.dropLast(1)) else value == p }
    }

    /**
     * Signing-certificate SHA-256 and install source of an installed game. A modified APK cannot keep
     * the official signature, and modified builds are spread as downloaded files, not through stores.
     */
    private fun gameInfo(packageName: String): JSONObject? = try {
        val info = pm.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        val signing = info.signingInfo
        val signatures: Array<Signature> = when {
            signing == null -> emptyArray()
            signing.hasMultipleSigners() -> signing.apkContentsSigners
            else -> signing.signingCertificateHistory
        }
        val digest = MessageDigest.getInstance("SHA-256")
        val certs = signatures.take(5).map { sig -> digest.digest(sig.toByteArray()).joinToString("") { "%02x".format(it) } }
        JSONObject().put("packageName", packageName).put("versionName", (info.versionName ?: "").take(200)).put("certSha256", JSONArray(certs))
            .apply { installer(packageName)?.let { put("installer", it) } }
    } catch (_: PackageManager.NameNotFoundException) { null }

    private fun installer(packageName: String): String? = try {
        val name = if (Build.VERSION.SDK_INT >= 30) pm.getInstallSourceInfo(packageName).installingPackageName
            else @Suppress("DEPRECATION") pm.getInstallerPackageName(packageName)
        name?.takeIf { Regex("^[a-zA-Z0-9._]{2,200}$").matches(it) }
    } catch (_: Exception) { null }

    private fun rootIndicators(): List<String> {
        val found = mutableListOf<String>()
        val paths = listOf("/system/bin/su", "/system/xbin/su", "/sbin/su", "/system/sd/xbin/su", "/data/local/su", "/data/local/bin/su",
            "/data/local/xbin/su", "/system/app/Superuser.apk", "/system/bin/.ext/su", "/cache/su", "/data/adb/magisk", "/sbin/.magisk")
        paths.filter { File(it).exists() }.forEach { found += it }
        System.getenv("PATH")?.split(":")?.map { "$it/su" }?.filter { it !in paths && File(it).exists() }?.forEach { found += it }
        if (Build.TAGS?.contains("test-keys") == true) found += "build signed with test-keys"
        return found.take(20)
    }

    private fun emulatorIndicators(): List<String> {
        val found = mutableListOf<String>()
        val fingerprint = Build.FINGERPRINT.lowercase()
        if (fingerprint.startsWith("generic") || fingerprint.contains("emulator") || fingerprint.contains("sdk_gphone")) found += "fingerprint ${Build.FINGERPRINT.take(120)}"
        if (Build.HARDWARE.contains("goldfish") || Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("vbox")) found += "hardware ${Build.HARDWARE}"
        if (Build.PRODUCT.contains("sdk") || Build.PRODUCT.contains("emulator") || Build.PRODUCT.contains("vbox")) found += "product ${Build.PRODUCT}"
        if (Build.MANUFACTURER.contains("Genymotion", ignoreCase = true) || Build.MODEL.contains("Android SDK built for")) found += "model ${Build.MANUFACTURER} ${Build.MODEL}"
        return found.take(20)
    }

    private fun accessibilityServices(): List<String> {
        val enabled = Settings.Secure.getInt(context.contentResolver, Settings.Secure.ACCESSIBILITY_ENABLED, 0) == 1
        if (!enabled) return emptyList()
        val list = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return emptyList()
        return list.split(":").map { it.trim().take(200) }.filter { it.isNotEmpty() }.take(50)
    }

    /** Third-party apps that currently hold "display over other apps". */
    private fun overlayPackages(installed: List<ApplicationInfo>): List<String> {
        val ops = context.getSystemService(AppOpsManager::class.java)
        return installed.asSequence()
            .filter { it.flags and ApplicationInfo.FLAG_SYSTEM == 0 && it.packageName != context.packageName }
            .filter { app ->
                val requested = try { pm.getPackageInfo(app.packageName, PackageManager.GET_PERMISSIONS).requestedPermissions?.contains(Manifest.permission.SYSTEM_ALERT_WINDOW) == true } catch (_: Exception) { false }
                requested && ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_SYSTEM_ALERT_WINDOW, app.uid, app.packageName) == AppOpsManager.MODE_ALLOWED
            }
            .map { it.packageName }.take(100).toList()
    }

    private fun globalFlag(name: String) = try { Settings.Global.getInt(context.contentResolver, name, 0) == 1 } catch (_: Exception) { false }

    fun hasUsageAccess(): Boolean {
        val ops = context.getSystemService(AppOpsManager::class.java)
        return ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName) == AppOpsManager.MODE_ALLOWED
    }

    /** The app most recently brought to the front, if the player granted usage access. */
    private fun foregroundPackage(): String? {
        if (!hasUsageAccess()) return null
        val usage = context.getSystemService(UsageStatsManager::class.java) ?: return null
        val now = System.currentTimeMillis()
        val events = usage.queryEvents(now - 5 * 60_000, now)
        val event = UsageEvents.Event()
        var last: String? = null
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType == UsageEvents.Event.ACTIVITY_RESUMED) last = event.packageName
        }
        return last?.takeIf { Regex("^[a-zA-Z0-9._]{2,200}$").matches(it) }
    }

    companion object { const val HEAVY_EVERY_MS = 60_000L }
}
