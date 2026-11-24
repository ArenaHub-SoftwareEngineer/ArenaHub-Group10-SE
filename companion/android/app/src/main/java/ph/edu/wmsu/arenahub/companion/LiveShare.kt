package ph.edu.wmsu.arenahub.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import io.livekit.android.LiveKit
import io.livekit.android.RoomOptions
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.participant.VideoTrackPublishDefaults
import io.livekit.android.room.track.LocalVideoTrackOptions
import io.livekit.android.room.track.ScreenSharePresets
import io.livekit.android.room.track.VideoCaptureParameter
import io.livekit.android.room.track.VideoCodec
import io.livekit.android.room.track.VideoEncoding
import io.livekit.android.room.track.screencapture.ScreenCaptureParams
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import livekit.org.webrtc.RtpParameters
import org.json.JSONObject

/**
 * Live screen sharing to match staff through LiveKit (WebRTC). The phone uploads ONE stream; LiveKit forwards it
 * to every facilitator, so more watchers never cost the phone anything. The LiveKit SDK runs its own
 * media-projection foreground service (with our notification), which also keeps this process alive.
 */
object LiveShare {
    private const val SHARE_NOTIFICATION = 23
    private const val PAUSE_NOTIFICATION = 24
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var room: Room? = null
    private var events: Job? = null
    @Volatile var running = false; private set

    /** Must be called while PovActivity is on screen: Android only lets a visible app start screen capture. */
    suspend fun start(context: Context, url: String, token: String, permission: Intent) {
        val app = context.applicationContext
        stop(app)
        val next = LiveKit.create(app, RoomOptions(
            // Dynacast: layers no facilitator is watching are not encoded, which saves the phone's battery and data.
            dynacast = true,
            screenShareTrackCaptureDefaults = LocalVideoTrackOptions(isScreencast = true, captureParams = VideoCaptureParameter(1280, 720, 15)),
            screenShareTrackPublishDefaults = VideoTrackPublishDefaults(
                videoEncoding = VideoEncoding(1_500_000, 15),
                simulcast = true,
                // Every Android phone has a hardware H.264 encoder, so sharing does not take CPU from the game.
                videoCodec = VideoCodec.H264.codecName,
                degradationPreference = RtpParameters.DegradationPreference.MAINTAIN_FRAMERATE,
                simulcastLayers = listOf(ScreenSharePresets.H360_FPS15),
            ),
        ))
        room = next
        events = scope.launch {
            next.events.collect { event ->
                when (event) {
                    is RoomEvent.RoomMetadataChanged -> showPause(app, event.newMetadata)
                    is RoomEvent.Disconnected -> if (room === next) cleanUp(app)
                    else -> {}
                }
            }
        }
        try {
            next.connect(url, token)
            showPause(app, next.metadata)
            val params = ScreenCaptureParams(permission, SHARE_NOTIFICATION, sharingNotification(app)) { scope.launch { stop(app) } }
            check(next.localParticipant.setScreenShareEnabled(true, params)) { "Screen sharing did not start." }
            running = true
        } catch (error: Exception) {
            stop(app)
            throw error
        }
    }

    fun stop(context: Context) {
        val current = room ?: return
        room = null
        current.disconnect()
        current.release()
        cleanUp(context.applicationContext)
    }

    private fun cleanUp(context: Context) {
        running = false
        room = null
        events?.cancel(); events = null
        context.getSystemService(NotificationManager::class.java).cancel(PAUSE_NOTIFICATION)
    }

    private fun channels(context: Context): NotificationManager {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("screen-wall", "Live game sharing", NotificationManager.IMPORTANCE_LOW))
        // High importance shows the pause as a heads-up banner over the game.
        manager.createNotificationChannel(NotificationChannel("match-paused", "Referee pauses", NotificationManager.IMPORTANCE_HIGH))
        return manager
    }

    private fun sharingNotification(context: Context): Notification {
        channels(context)
        val stop = PendingIntent.getActivity(context, 22, Intent(context, PovActivity::class.java).setAction(PovActivity.ACTION_STOP).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(context, "screen-wall").setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("ArenaHub is sharing your screen").setContentText("Match staff can see your game. Tap to stop sharing.")
            .setContentIntent(stop).setOngoing(true).build()
    }

    private fun showPause(context: Context, metadata: String?) {
        val manager = channels(context)
        val state = try { JSONObject(metadata ?: "{}") } catch (_: Exception) { JSONObject() }
        if (!state.optBoolean("paused")) { manager.cancel(PAUSE_NOTIFICATION); return }
        val note = state.optString("note").take(200)
        manager.notify(PAUSE_NOTIFICATION, Notification.Builder(context, "match-paused").setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("The referee paused this match")
            .setContentText(if (note.isNotBlank()) note else "Stop playing and pause the game now.")
            .setStyle(Notification.BigTextStyle().bigText((if (note.isNotBlank()) "$note\n" else "") + "Stop playing and pause the game now. Keep sharing until the referee resumes."))
            .setCategory(Notification.CATEGORY_ALARM).setOngoing(true).build())
    }
}
