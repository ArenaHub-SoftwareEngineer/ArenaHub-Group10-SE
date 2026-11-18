package ph.edu.wmsu.arenahub.companion

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingDeque
import java.util.concurrent.TimeUnit

/** Shared, read-only view of the session for the screen. */
object MonitorState {
    @Volatile var running = false
    @Volatile var status = "Not monitoring"
    @Volatile var lastReport = 0L
    @Volatile var pendingUploads = 0
}

/**
 * Foreground service for one match. Reports device facts every 15 s, records the screen and uploads
 * segments. Stops when the server says the window closed (HTTP 410), the player stops it, or Android
 * revokes screen capture.
 */
class MonitorService : Service() {
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private val uploader = Executors.newSingleThreadExecutor()
    private val queue = LinkedBlockingDeque<File>()
    private var recorder: ScreenRecorder? = null
    private lateinit var server: String
    private lateinit var token: String
    private var gamePackages = listOf<String>()
    private var blockedCertificates = listOf<String>()
    private var scanStamp: JSONObject? = null
    private var blocked = listOf<String>()
    private var recordingRefused = false
    private lateinit var checks: DeviceChecks
    @Volatile private var stopping = false
    private val deadlineHandler = Handler(Looper.getMainLooper())
    private val expireWindow = Runnable { shutdown("The match window closed.", notifyServer = false) }
    // Rescan installed apps as soon as something is installed, updated or removed.
    private val appsChanged = object : BroadcastReceiver() { override fun onReceive(context: Context, intent: Intent) { checks.invalidate() } }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { shutdown("You stopped monitoring.", notifyServer = true); return START_NOT_STICKY }
        if (intent == null || MonitorState.running) return START_NOT_STICKY
        server = intent.getStringExtra(EXTRA_SERVER) ?: return START_NOT_STICKY
        token = intent.getStringExtra(EXTRA_TOKEN) ?: return START_NOT_STICKY
        gamePackages = intent.getStringArrayListExtra(EXTRA_GAMES) ?: arrayListOf()
        blocked = intent.getStringArrayListExtra(EXTRA_BLOCKED) ?: arrayListOf()
        blockedCertificates = intent.getStringArrayListExtra(EXTRA_CERTIFICATES) ?: arrayListOf()
        scanStamp = intent.getStringExtra(EXTRA_SCAN)?.let { JSONObject(it) }
        val remaining = intent.getLongExtra(EXTRA_EXPIRES, 0) - System.currentTimeMillis()
        if (remaining <= 0 || remaining > 12 * 3600_000L) { stopSelf(); return START_NOT_STICKY }
        // Do not keep capturing past the consent window if the API is unreachable.
        deadlineHandler.postDelayed(expireWindow, remaining)
        val heartbeat = intent.getIntExtra(EXTRA_HEARTBEAT, 15).coerceIn(5, 120).toLong()
        val wantsRecording = intent.getBooleanExtra(EXTRA_RECORD, true)
        checks = DeviceChecks(this)

        val data: Intent? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_PROJECTION_DATA, Intent::class.java)
            else @Suppress("DEPRECATION") intent.getParcelableExtra<Intent>(EXTRA_PROJECTION_DATA)
        recordingRefused = wantsRecording && data == null
        // Android 14+: the service must already be in the foreground with the mediaProjection type before
        // the projection token is used, and may only use that type after the player allowed recording.
        val type = when {
            data != null -> ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            Build.VERSION.SDK_INT >= 34 -> ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            else -> ServiceInfo.FOREGROUND_SERVICE_TYPE_MANIFEST
        }
        MonitorState.status = "Starting anti-cheat scan"
        startForeground(NOTIFICATION_ID, notification(), type)
        MonitorState.running = true
        MonitorState.status = "Monitoring on"
        val filter = IntentFilter().apply { addAction(Intent.ACTION_PACKAGE_ADDED); addAction(Intent.ACTION_PACKAGE_REPLACED); addAction(Intent.ACTION_PACKAGE_REMOVED); addDataScheme("package") }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(appsChanged, filter, Context.RECEIVER_EXPORTED) else registerReceiver(appsChanged, filter)

        val resultCode = intent.getIntExtra(EXTRA_PROJECTION_CODE, Activity.RESULT_CANCELED)
        val projection = data?.let { getSystemService(MediaProjectionManager::class.java).getMediaProjection(resultCode, it) }
        if (projection != null) {
            recorder = ScreenRecorder(this, projection, onSegment = { file -> enqueue(file) }, onStopped = { MonitorState.status = "Screen recording was stopped. The referee will see this." }).also { it.start() }
        } else if (recordingRefused) MonitorState.status = "Monitoring on. You did not allow screen recording, and the referee has been told."
        else MonitorState.status = "Monitoring on (the referee did not ask for screen recording)."

        scheduler.scheduleWithFixedDelay({ report() }, 0, heartbeat, TimeUnit.SECONDS)
        return START_NOT_STICKY
    }

    private fun report() {
        if (stopping) return
        try {
            val facts = checks.collect(gamePackages, blocked, recorder?.isRecording == true, recordingRefused, blockedCertificates, scanStamp)
            val result = Api.postJson(server, "/device/heartbeat", facts, token)
            when {
                result.code == 410 -> shutdown("The match window closed.", notifyServer = false)
                result.ok -> {
                    val monitor = result.json().optJSONObject("monitor")
                    monitor?.optJSONArray("gamePackages")?.let { gamePackages = it.strings() }
                    monitor?.optJSONArray("blockedPackages")?.let { blocked = it.strings() }
                    monitor?.optJSONArray("blockedCertificates")?.let { blockedCertificates = it.strings() }
                    scanStamp = monitor?.optJSONObject("scan")
                    MonitorState.lastReport = System.currentTimeMillis()
                    val scan = result.json().optJSONObject("scan")
                    MonitorState.status = scan?.let { "${it.optString("label")}: ${it.optString("detail")}" } ?: "Scan running"
                }
                else -> MonitorState.status = result.error("The tournament server rejected a scan (${result.code}).")
            }
        } catch (_: Exception) {
            MonitorState.status = "Cannot reach the tournament server. Check your Wi-Fi or mobile data. Retrying..."
        }
        try {
            if (!stopping) getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification())
        } catch (_: SecurityException) { /* Keep scanning if the player disabled notifications. */ }
    }

    @Synchronized private fun enqueue(file: File) {
        // The recorder finishes asynchronously; never retain a late segment after consent ends.
        if (stopping) { file.delete(); return }
        queue.add(file)
        // Keep at most about 20 minutes of unsent video on the phone if the connection drops.
        while (queue.size > 40) queue.pollFirst()?.delete()
        MonitorState.pendingUploads = queue.size
        // The last segment can finish after shutdown began; shutdown's own drain sends what it can.
        try { uploader.execute { drain() } } catch (_: java.util.concurrent.RejectedExecutionException) {}
    }

    private fun drain() {
        while (true) {
            val file = queue.peekFirst() ?: return
            try {
                val result = Api.postFile(server, "/device/media", file, "video/mp4", token)
                if (result.ok || result.code == 400 || result.code == 410 || result.code == 507) { queue.remove(file); file.delete() }
                else return
            } catch (_: Exception) { return }
            finally { MonitorState.pendingUploads = queue.size }
        }
    }

    @Synchronized private fun shutdown(reason: String, notifyServer: Boolean) {
        if (stopping) return
        stopping = true
        MonitorState.status = reason
        recorder?.stop()
        scheduler.shutdownNow()
        uploader.execute {
            drain()
            if (notifyServer) try { Api.postJson(server, "/device/stop", JSONObject(), token) } catch (_: Exception) {}
            queue.forEach { it.delete() }
            MonitorState.running = false
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
        uploader.shutdown()
    }

    override fun onDestroy() {
        stopping = true
        deadlineHandler.removeCallbacks(expireWindow)
        recorder?.stop()
        scheduler.shutdownNow()
        uploader.shutdownNow()
        queue.forEach { it.delete() }
        queue.clear()
        try { unregisterReceiver(appsChanged) } catch (_: Exception) {}
        MonitorState.running = false
        super.onDestroy()
    }

    private fun notification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.notification_channel), NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, MonitorService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(MonitorState.status)
            .setStyle(Notification.BigTextStyle().bigText(MonitorState.status))
            .setOnlyAlertOnce(true)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(Icon.createWithResource(this, android.R.drawable.ic_menu_close_clear_cancel), "Stop", stop).build())
            .build()
    }

    private fun JSONArray.strings() = (0 until length()).map { getString(it) }

    companion object {
        const val CHANNEL = "monitor"
        const val NOTIFICATION_ID = 7
        const val ACTION_STOP = "ph.edu.wmsu.arenahub.companion.STOP"
        const val EXTRA_SERVER = "server"
        const val EXTRA_TOKEN = "token"
        const val EXTRA_GAMES = "games"
        const val EXTRA_BLOCKED = "blocked"
        const val EXTRA_CERTIFICATES = "certificates"
        const val EXTRA_EXPIRES = "expiresAt"
        const val EXTRA_SCAN = "scan"
        const val EXTRA_HEARTBEAT = "heartbeat"
        const val EXTRA_RECORD = "record"
        const val EXTRA_PROJECTION_CODE = "projectionCode"
        const val EXTRA_PROJECTION_DATA = "projectionData"

        fun stop(context: Context) { context.startService(Intent(context, MonitorService::class.java).setAction(ACTION_STOP)) }
    }
}
