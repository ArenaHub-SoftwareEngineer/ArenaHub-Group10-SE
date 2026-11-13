package ph.edu.wmsu.arenahub.companion

import android.content.Context
import android.hardware.display.DisplayManager
import android.net.ConnectivityManager
import android.hardware.display.VirtualDisplay
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import java.io.File

/**
 * Records the screen in 30-second MP4 segments (no audio) and hands each finished file to [onSegment].
 * On Wi-Fi: 720p, 24 fps, 1.5 Mbit/s (about 11 MB a minute). On mobile data or a metered hotspot:
 * 480p, 20 fps, 0.6 Mbit/s (about 4.5 MB a minute), so players on their own load are not drained.
 * The video size is fixed when recording starts; the bitrate is re-checked for every segment. Android 14 allows only one virtual display per projection, so the display is created
 * once and pointed at each new MediaRecorder's surface.
 */
class ScreenRecorder(
    private val context: Context,
    private val projection: MediaProjection,
    private val onSegment: (File) -> Unit,
    private val onStopped: () -> Unit,
) {
    private val thread = HandlerThread("arenahub-recorder").apply { start() }
    private val handler = Handler(thread.looper)
    private var display: VirtualDisplay? = null
    private var recorder: MediaRecorder? = null
    private var current: File? = null
    @Volatile var isRecording = false
        private set
    private val width: Int
    private val height: Int
    private val dpi: Int

    init {
        val metrics = context.resources.displayMetrics
        val scale = (if (metered()) 854.0 else 1280.0) / maxOf(metrics.widthPixels, metrics.heightPixels)
        val factor = if (scale < 1) scale else 1.0
        width = ((metrics.widthPixels * factor).toInt() / 2) * 2
        height = ((metrics.heightPixels * factor).toInt() / 2) * 2
        dpi = metrics.densityDpi
    }

    private val rotate = object : Runnable {
        override fun run() { rotateSegment(); handler.postDelayed(this, SEGMENT_MS) }
    }

    fun start() = handler.post {
        projection.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() { handler.post { finish(); onStopped() } }
        }, handler)
        val first = newRecorder() ?: return@post
        display = projection.createVirtualDisplay("ArenaHubMonitor", width, height, dpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, first.surface, null, handler)
        first.start()
        recorder = first
        isRecording = true
        handler.postDelayed(rotate, SEGMENT_MS)
    }

    fun stop() = handler.post {
        finish()
        try { projection.stop() } catch (_: Exception) {}
        thread.quitSafely()
    }

    private fun newRecorder(): MediaRecorder? = try {
        val file = File(context.cacheDir, "segment-${System.currentTimeMillis()}.mp4")
        (if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()).apply {
            setVideoSource(MediaRecorder.VideoSource.SURFACE)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setVideoEncoder(MediaRecorder.VideoEncoder.H264)
            setVideoSize(width, height)
            // Low frame rates and bitrates keep the phone's video chip lightly loaded and uploads small.
            val saver = metered()
            setVideoFrameRate(if (saver) 20 else 24)
            setVideoEncodingBitRate(if (saver) 600_000 else 1_500_000)
            setOutputFile(file.absolutePath)
            prepare()
        }.also { current = file }
    } catch (_: Exception) { isRecording = false; null }

    /** Finishes the running segment and immediately continues into a new one. */
    private fun rotateSegment() {
        val finished = current
        val old = recorder ?: return
        val next = newRecorder()
        if (next != null) {
            display?.surface = next.surface
            next.start()
        }
        stopQuietly(old, finished)
        recorder = next
        isRecording = next != null
    }

    private fun finish() {
        handler.removeCallbacks(rotate)
        recorder?.let { stopQuietly(it, current) }
        recorder = null
        display?.release()
        display = null
        isRecording = false
    }

    private fun stopQuietly(rec: MediaRecorder, file: File?) {
        try { rec.stop() } catch (_: Exception) { file?.delete(); rec.release(); return }
        rec.release()
        if (file != null && file.length() > 0) onSegment(file)
    }

    /** Mobile data and metered hotspots count as metered; unknown networks are treated as metered to be safe. */
    private fun metered(): Boolean = try { context.getSystemService(ConnectivityManager::class.java)?.isActiveNetworkMetered ?: true } catch (_: Exception) { true }

    companion object { const val SEGMENT_MS = 30_000L }
}
