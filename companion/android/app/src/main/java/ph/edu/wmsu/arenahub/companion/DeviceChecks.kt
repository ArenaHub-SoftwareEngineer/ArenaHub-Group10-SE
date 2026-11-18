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
import java.net.InetSocketAddress
import java.net.Socket
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

    private class Heavy(val games: JSONArray, val flagged: List<String>, val overlays: List<String>, val certificates: JSONArray, val checks: JSONObject)

    /** Called when apps change, so the next report rescans. */
    @Synchronized fun invalidate() { heavy = null }

    @Synchronized
    fun collect(gamePackages: List<String>, blockedPatterns: List<String>, recording: Boolean, recordingRefused: Boolean, blockedCertificates: List<String> = emptyList(), scanStamp: JSONObject? = null): JSONObject {
        val key = (gamePackages + "|" + blockedPatterns + "|" + blockedCertificates).joinToString(",")
        val now = SystemClock.elapsedRealtime()
        val inspection = heavy?.takeIf { key == heavyKey && now - heavyAt < HEAVY_EVERY_MS } ?: scanApps(gamePackages, blockedPatterns, blockedCertificates).also { heavy = it; heavyAt = now; heavyKey = key }
        return JSONObject()
            .put("platform", "android")
            .put("games", inspection.games)
            .put("installedFlagged", JSONArray(inspection.flagged))
            .put("rootIndicators", JSONArray(rootIndicators()))
            .put("emulatorIndicators", JSONArray(emulatorIndicators()))
            .put("accessibilityServices", JSONArray(accessibilityServices()))
            .put("overlayPackages", JSONArray(inspection.overlays))
            .put("blockedCertificateMatches", inspection.certificates)
            .put("checks", inspection.checks)
            .put("hookIndicators", JSONArray(hookIndicators()))
            .put("virtualIndicators", JSONArray(virtualIndicators(blockedPatterns)))
            .put("developerOptions", globalFlag(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED))
            .put("usbDebugging", globalFlag(Settings.Global.ADB_ENABLED) || globalFlag("adb_wifi_enabled"))
            .put("recording", recording)
            .put("recordingRefused", recordingRefused)
            .withScanStamp(scanStamp)
            .apply { foregroundPackage()?.let { put("foregroundPackage", it) } }
    }

    private fun scanApps(gamePackages: List<String>, blockedPatterns: List<String>, blockedCertificates: List<String>): Heavy {
        val checks = JSONObject().put("installedApps", true).put("gameSignatures", true).put("overlays", true).put("certificates", true)
        val installed = try { pm.getInstalledApplications(0) } catch (_: Exception) { checks.put("installedApps", false); emptyList() }
        if (Build.VERSION.SDK_INT >= 30 && context.checkSelfPermission(Manifest.permission.QUERY_ALL_PACKAGES) != PackageManager.PERMISSION_GRANTED) checks.put("installedApps", false)
        val games = JSONArray()
        gamePackages.forEach { name -> try { gameInfo(name)?.let { games.put(it) } } catch (_: Exception) { checks.put("gameSignatures", false) } }
        val certMatches = JSONArray()
        if (blockedCertificates.isNotEmpty()) installed.forEach { app ->
            try {
                signingCertificates(app.packageName).filter { blockedCertificates.contains(it) }.forEach { hash ->
                    if (certMatches.length() < 100) certMatches.put(JSONObject().put("packageName", app.packageName).put("sha256", hash))
                    else checks.put("certificates", false)
                }
            } catch (_: PackageManager.NameNotFoundException) { /* App removed during the scan. */ }
            catch (_: Exception) { checks.put("certificates", false) }
        }
        val flagged = installed.map { it.packageName }.filter { matchesAny(it, blockedPatterns) }
        if (flagged.size > 100) checks.put("installedApps", false)
        return Heavy(
            games,
            flagged.take(100),
            overlayPackages(installed, checks), certMatches, checks,
        )
    }

    /** Trailing * matches a prefix, otherwise the name must match exactly (case-insensitive). */
    private fun matchesAny(name: String, patterns: List<String>): Boolean {
        val value = name.lowercase()
        return patterns.any { raw -> val p = raw.lowercase(); if (p.endsWith("*")) value.startsWith(p.dropLast(1)) else value == p }
    }

    /**
     * Signing-certificate SHA-256 and install source. Staff maintain regional publisher trust lists;
     * neither an installer name nor a client-reported certificate is device attestation.
     */
    private fun gameInfo(packageName: String): JSONObject? = try {
        val info = pm.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        JSONObject().put("packageName", packageName).put("versionName", (info.versionName ?: "").take(200)).put("certSha256", JSONArray(signingCertificates(packageName)))
            .apply { installer(packageName)?.let { put("installer", it) } }
    } catch (_: PackageManager.NameNotFoundException) { null }

    private fun signingCertificates(packageName: String): List<String> {
        val info = pm.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        val signing = info.signingInfo
        val signatures: Array<Signature> = when {
            signing == null -> emptyArray()
            signing.hasMultipleSigners() -> signing.apkContentsSigners
            else -> signing.signingCertificateHistory
        }
        val digest = MessageDigest.getInstance("SHA-256")
        return signatures.take(5).map { sig -> digest.digest(sig.toByteArray()).joinToString("") { "%02x".format(it) } }
    }

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
        if (Build.TYPE == "userdebug" || Build.TYPE == "eng") found += "debuggable system build (${Build.TYPE})"
        // Usually unreadable on stock phones; a readable "0" means SELinux protection is off.
        try { if (File("/sys/fs/selinux/enforce").readText().trim() == "0") found += "SELinux permissive" } catch (_: Exception) { }
        return found.take(20)
    }

    /**
     * Hooking frameworks (Frida, Xposed/LSPosed, Zygisk, Riru, Substrate) are how most Android game mods and
     * injectors change another app. Their libraries show up in this process's memory map when they inject into
     * every app, root frameworks leave mounts, and a Frida server listens on a local port.
     */
    private fun hookIndicators(): List<String> {
        val found = mutableListOf<String>()
        try {
            File("/proc/self/maps").useLines { lines ->
                lines.map { it.lowercase() }
                    .filter { line -> HOOK_MARKERS.any { line.contains(it) } }
                    .map { it.substringAfterLast('/').take(80) }
                    .distinct().take(10).forEach { found += "hook library in companion: $it" }
            }
        } catch (_: Exception) { }
        try {
            File("/proc/self/mounts").useLines { lines ->
                if (lines.any { line -> val l = line.lowercase(); l.contains("magisk") || l.contains("/debug_ramdisk") || l.contains("zygisk") }) found += "root framework mount"
            }
        } catch (_: Exception) { }
        if (localPortOpen(27042)) found += "Frida server answering on port 27042"
        return found.distinct().take(20)
    }

    /** Runs on the scheduler thread, never the main thread. A closed local port is refused immediately. */
    private fun localPortOpen(port: Int): Boolean = try {
        Socket().use { it.connect(InetSocketAddress("127.0.0.1", port), 150); true }
    } catch (_: Exception) { false }

    /**
     * App cloners and virtual phones run the guest app from their own data folder. A normal install keeps
     * its data in /data/user/<n>/<package> or /data/data/<package>.
     */
    private fun virtualIndicators(blockedPatterns: List<String>): List<String> {
        val found = mutableListOf<String>()
        val pkg = Regex.escape(context.packageName)
        val dataDir = context.applicationInfo.dataDir ?: ""
        if (!Regex("^/data/(user|user_de)/\\d+/$pkg/?$|^/data/data/$pkg/?$").matches(dataDir)) found += "unexpected app data folder ${dataDir.take(120)}"
        try {
            File("/proc/self/maps").useLines { lines ->
                lines.mapNotNull { Regex("/data/(?:app|data|user/\\d+)/(?:~~[^/]+/)?([A-Za-z0-9._]+?)(?:-[^/]*)?/").find(it)?.groupValues?.get(1) }
                    .filter { it != context.packageName && matchesAny(it, blockedPatterns) }
                    .distinct().take(5).forEach { found += "loaded from listed app $it" }
            }
        } catch (_: Exception) { }
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
    private fun overlayPackages(installed: List<ApplicationInfo>, checks: JSONObject): List<String> {
        val ops = context.getSystemService(AppOpsManager::class.java)
        return installed.asSequence()
            .filter { it.flags and ApplicationInfo.FLAG_SYSTEM == 0 && it.packageName != context.packageName }
            .filter { app ->
                val requested = try { pm.getPackageInfo(app.packageName, PackageManager.GET_PERMISSIONS).requestedPermissions?.contains(Manifest.permission.SYSTEM_ALERT_WINDOW) == true } catch (_: Exception) { false }
                try { requested && ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_SYSTEM_ALERT_WINDOW, app.uid, app.packageName) == AppOpsManager.MODE_ALLOWED }
                catch (_: SecurityException) { checks.put("overlays", false); false }
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

    companion object {
        const val HEAVY_EVERY_MS = 60_000L
        /** Library-name markers of hooking frameworks, matched case-insensitively in /proc/self/maps. */
        val HOOK_MARKERS = listOf("frida", "xposed", "lspd", "lsposed", "edxp", "riru", "zygisk", "substrate", "sandhook")
    }
}
