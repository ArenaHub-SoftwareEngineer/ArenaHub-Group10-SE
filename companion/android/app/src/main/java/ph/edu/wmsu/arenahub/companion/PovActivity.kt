package ph.edu.wmsu.arenahub.companion

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.widget.ScrollView
import android.widget.TextView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** This separate consent is for live viewing only. Starting a scan never starts a broadcast. */
class PovActivity : Activity() {
    companion object { const val ACTION_STOP = "ph.edu.wmsu.arenahub.companion.STOP_SHARING" }
    private data class Link(val server: String, val key: String)
    private val scope = MainScope()
    private var checkedLink: Link? = null
    private lateinit var status: TextView

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        if (intent?.action == ACTION_STOP) { LiveShare.stop(this); finish(); return }
        checkedLink = lastNonConfigurationInstance as? Link
        val ui = Ui(this, Palette.of(this))
        val content = ui.column().apply {
            setBackgroundColor(ui.c.bg)
            setPadding(ui.dp(24), ui.dp(32), ui.dp(24), ui.dp(24))
            addView(ui.title("Share game screen"))
            status = ui.muted("")
            status.accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
            addView(status)
        }
        setContentView(ScrollView(this).apply { isFillViewport = true; addView(content) })
        if (LiveShare.running) {
            status.text = "Your game is visible to match staff."
            content.addView(ui.danger("Stop sharing", R.drawable.ic_power) {
                LiveShare.stop(this)
                finish()
            })
        } else if (MonitorState.recording == "on") {
            status.text = "Stop the current recording from its notification before starting live sharing."
        } else {
            val input = ui.input("Paste your private sharing link").apply {
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
                isSaveEnabled = false
            }
            val check = ui.primary("Check match") {
                val url = Uri.parse(input.text.toString().trim())
                val link = if (url.isHierarchical && url.path == "/pov.html") {
                    Link(url.buildUpon().path("").fragment(null).build().toString(), url.fragment.orEmpty())
                } else null
                if (link != null) checkMatch(link)
                else status.text = "Copy the private sharing link from your match check-in."
            }
            content.addView(input)
            content.addView(check)
            status.text = "Open the screen-sharing link from match check-in, or paste it here."
            val data = intent.data
            if (state == null && data?.isHierarchical == true && data.scheme == "arenahub" && data.host == "pov") {
                checkMatch(Link(data.getQueryParameter("s").orEmpty(), data.getQueryParameter("key").orEmpty()))
            }
        }
    }

    @Suppress("DEPRECATION")
    override fun onRetainNonConfigurationInstance(): Any? = checkedLink

    private fun checkMatch(link: Link) {
        if (LiveShare.running || MonitorState.recording == "on") {
            status.text = "A screen capture is already active. Stop it from its notification before starting another."
            return
        }
        if (!Api.validServer(link.server) || !link.key.matches(Regex("[A-Za-z0-9_.-]{40,240}"))) {
            status.text = "Open your private sharing link from match check-in."
            return
        }
        if (checking) return
        checking = true
        status.text = "Checking the match…"
        Thread {
            val info = try { Api.pov(link.server, "info", link.key).takeIf { it.ok }?.json() } catch (_: Exception) { null }
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                checking = false
                if (info == null) { status.text = "Check-in unavailable. Reopen the link from your match."; return@runOnUiThread }
                if (!info.optBoolean("ready")) { status.text = "Live screens are not switched on for this event yet. Tell your organizer."; return@runOnUiThread }
                status.text = "Choose what to share."
                AlertDialog.Builder(this).setTitle("Share " + info.optString("name") + "’s screen?")
                    .setMessage(info.optString("gameLabel") + " · " + info.optString("match") + "\n" + link.server + "\n\nYour match facilitators watch your screen live. Other players cannot see it. When Android asks, choose \"Entire screen\": a single-app share hides other apps' floating windows from the referee. Stop from the sharing notification.")
                    .setNegativeButton("Cancel", null)
                    .setPositiveButton("Choose game") { _, _ ->
                        checkedLink = link
                        startActivityForResult(getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent(), 17)
                    }.show()
            }
        }.start()
    }
    private var checking = false

    @Deprecated("Platform activity result callback")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 17) return
        val link = checkedLink
        checkedLink = null
        if (resultCode == RESULT_OK && data != null && link != null) {
            status.text = "Connecting to match staff…"
            scope.launch {
                try {
                    val access = withContext(Dispatchers.IO) { Api.pov(link.server.trimEnd('/'), "token", link.key) }
                    val body = access.json()
                    if (!access.ok) throw IllegalStateException(body.optString("error", "Sharing could not start."))
                    // Start while this screen is visible: Android blocks starting screen capture from the background.
                    LiveShare.start(this@PovActivity, body.getString("url"), body.getString("token"), data)
                    status.text = "Your screen is live for match staff. Return to your game."
                    moveTaskToBack(true)
                    finish()
                } catch (error: Exception) {
                    status.text = (error.message ?: "Sharing could not start.") + " Check the match to try again."
                }
            }
        } else {
            status.text = "Screen sharing was not started. Check the match to try again."
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
