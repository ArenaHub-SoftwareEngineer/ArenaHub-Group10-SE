package ph.edu.wmsu.arenahub.companion

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.app.Activity
import android.app.AlertDialog
import android.content.ClipboardManager
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Live screen sharing, one step at a time: 1 add the private link, 2 check the match, 3 go live (and end it).
 * This consent is for live viewing only. Starting a scan never starts a broadcast.
 */
class PovActivity : Activity() {
    companion object {
        const val ACTION_STOP = "ph.edu.wmsu.arenahub.companion.STOP_SHARING"
        private const val REQUEST_CAPTURE = 17
        private val KEY = Regex("[A-Za-z0-9_.-]{40,240}")
        private val URL_IN_TEXT = Regex("(https?|arenahub)://[^\\s\"'<>]+", RegexOption.IGNORE_CASE)

        /** Kept for this app run only (never saved), so "Go live again" works after the player ends a live. */
        private var link: Link? = null
        private var info: JSONObject? = null

        /**
         * Reads the private link however the player got it: the sharing page (…/pov.html#KEY), the check-in page
         * (…/join.html?c=…#screen=KEY), the app link (arenahub://pov?s=…&key=…), or a message with the link inside.
         */
        internal fun parseLink(raw: String): Link? {
            val text = raw.trim()
            val found = URL_IN_TEXT.find(text)?.value ?: return null
            val url = Uri.parse(found)
            if (!url.isHierarchical) return null
            val link = when (url.scheme?.lowercase()) {
                "arenahub" -> if (url.host == "pov") Link(url.getQueryParameter("s").orEmpty().trimEnd('/'), url.getQueryParameter("key").orEmpty()) else null
                "http", "https" -> {
                    val path = url.path.orEmpty().trimEnd('/')
                    val fragment = url.encodedFragment.orEmpty()
                    val key = when {
                        path.endsWith("/pov.html") || path.endsWith("/pov") -> fragment
                        path.endsWith("/join.html") || path.endsWith("/join") -> Uri.parse("x:?$fragment").getQueryParameter("screen").orEmpty()
                        else -> ""
                    }
                    val server = url.scheme!!.lowercase() + "://" + url.encodedAuthority.orEmpty()
                    Link(server, Uri.decode(key))
                }
                else -> null
            } ?: return null
            return link.takeIf { it.key.matches(KEY) }
        }
    }

    internal data class Link(val server: String, val key: String)
    private enum class Step { LINK, CHECKING, MATCH, CONNECTING, LIVE, ENDED }

    private val scope = MainScope()
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var ui: Ui
    private lateinit var content: LinearLayout
    private var step = Step.LINK
    private var error: String? = null
    private var typed = ""
    private var timer: TextView? = null
    private var pulse: ValueAnimator? = null
    private val tick = object : Runnable {
        override fun run() {
            timer?.text = elapsed()
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(state: Bundle?) {
        requestWindowFeature(Window.FEATURE_NO_TITLE)
        super.onCreate(state)
        val palette = Palette.of(this)
        ui = Ui(this, palette)
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false)
        @Suppress("DEPRECATION") run { window.statusBarColor = 0; window.navigationBarColor = 0 }
        window.decorView.setBackgroundColor(palette.bg)

        val page = ui.column().apply { layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT) }
        page.addView(header())
        content = ui.column()
        page.addView(content)
        val scroll = ScrollView(this).apply { setBackgroundColor(palette.bg); isFillViewport = true; addView(page) }
        scroll.setOnApplyWindowInsetsListener { _, insets ->
            val (left, top, right, bottom) = if (Build.VERSION.SDK_INT >= 30) insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime()).let { listOf(it.left, it.top, it.right, it.bottom) }
                else @Suppress("DEPRECATION") listOf(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            page.setPadding(ui.dp(16) + left, ui.dp(12) + top, ui.dp(16) + right, ui.dp(28) + bottom)
            insets
        }
        setContentView(scroll)
        if (Build.VERSION.SDK_INT >= 30 && palette.bg != 0xFF0E0E10.toInt()) {
            val light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(light, light)
        }
        step = if (LiveShare.running) Step.LIVE else Step.LINK
        if (!handle(intent)) render()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (!handle(intent)) render()
    }

    /** The notification's "End live", or an arenahub://pov link from the sharing page. Returns true if it rendered. */
    private fun handle(intent: Intent?): Boolean {
        if (intent?.action == ACTION_STOP) {
            if (LiveShare.running) LiveShare.stop(this)
            go(Step.ENDED)
            return true
        }
        val data = intent?.data ?: return false
        if (data.scheme != "arenahub" || data.host != "pov") return false
        intent.data = null
        if (LiveShare.running) { go(Step.LIVE); return true }
        val parsed = parseLink(data.toString())
        if (parsed == null) { error = "This sharing link is incomplete. On the ArenaHub sharing page, tap Copy private sharing link and paste it here."; go(Step.LINK) }
        else checkLink(parsed)
        return true
    }

    override fun onResume() {
        super.onResume()
        LiveShare.onChange = { runOnUiThread { onLiveChanged() } }
        // Sharing may have ended (or started) while this screen was in the background.
        if (step == Step.LIVE && !LiveShare.running) go(Step.ENDED)
        else if (LiveShare.running && step != Step.LIVE) go(Step.LIVE)
        handler.post(tick)
    }

    override fun onPause() {
        handler.removeCallbacks(tick)
        LiveShare.onChange = null
        super.onPause()
    }

    private fun onLiveChanged() {
        when {
            step == Step.LIVE && !LiveShare.running -> go(Step.ENDED)
            step == Step.LIVE -> render()
        }
    }

    @Deprecated("Platform Activity API; no AndroidX dependency in this app.")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        when (step) {
            Step.MATCH -> go(Step.LINK)
            Step.LIVE -> moveTaskToBack(true)
            Step.CHECKING, Step.CONNECTING -> {}
            else -> super.onBackPressed()
        }
    }

    // ---- Steps ----

    private fun go(next: Step) {
        step = next
        render()
    }

    private fun render() {
        pulse?.cancel(); pulse = null
        timer = null
        content.removeAllViews()
        content.addView(rail())
        when (step) {
            Step.LINK -> linkStep()
            Step.CHECKING -> waiting("Checking your match…", "Making sure this link belongs to your match check-in.")
            Step.MATCH -> matchStep()
            Step.CONNECTING -> waiting("Starting your live…", "Connecting to your match staff. Keep this screen open.")
            Step.LIVE -> liveStep()
            Step.ENDED -> endedStep()
        }
    }

    private fun header() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        setPadding(0, ui.dp(8), 0, ui.dp(10))
        addView(ImageView(context).apply { setImageResource(R.drawable.ic_logo); layoutParams = LinearLayout.LayoutParams(ui.dp(26), ui.dp(26)).apply { marginEnd = ui.dp(10) } })
        addView(ui.text("Share game screen", 16f, ui.c.text, 700).apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) })
    }

    /** Three numbered stops: Link, Match, Live. Finished ones turn green. */
    private fun rail() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        setPadding(0, ui.dp(4), 0, ui.dp(14))
        val at = when (step) { Step.LINK, Step.CHECKING -> 0; Step.MATCH, Step.CONNECTING -> 1; Step.LIVE, Step.ENDED -> 2 }
        listOf("Link", "Match", "Live").forEachIndexed { index, label ->
            val done = index < at || step == Step.ENDED
            val current = index == at && step != Step.ENDED
            val tint = when { done -> ui.c.ok; current -> ui.c.brand; else -> ui.c.lineStrong }
            if (index > 0) addView(View(context).apply {
                setBackgroundColor(if (index <= at) ui.c.soft(ui.c.ok, 0x99) else ui.c.line)
                layoutParams = LinearLayout.LayoutParams(0, ui.dp(2), 1f).apply { marginStart = ui.dp(6); marginEnd = ui.dp(6) }
            })
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                addView(TextView(context).apply {
                    text = if (done) "✓" else (index + 1).toString()
                    textSize = 12f; gravity = Gravity.CENTER
                    setTextColor(if (done || current) ui.c.onBrand else ui.c.muted)
                    background = android.graphics.drawable.GradientDrawable().apply { shape = android.graphics.drawable.GradientDrawable.OVAL; setColor(if (done || current) tint else 0) ; setStroke(ui.dp(1), tint) }
                    layoutParams = LinearLayout.LayoutParams(ui.dp(22), ui.dp(22)).apply { marginEnd = ui.dp(6) }
                })
                addView(ui.text(label, 13f, if (current) ui.c.text else ui.c.muted, if (current) 650 else 500).apply { layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT) })
            })
        }
    }

    private fun stepCard(iconRes: Int?, tone: Tone, title: String, text: String?) = ui.card(top = 0).apply {
        setPadding(ui.dp(20), ui.dp(26), ui.dp(20), ui.dp(22))
        addView(ui.badge(iconRes, tone, 64))
        addView(ui.title(title, center = true, size = 24f))
        if (!text.isNullOrBlank()) addView(ui.muted(text, 15f, top = 8, center = true))
    }.also { content.addView(it) }

    private fun linkStep() {
        val card = stepCard(R.drawable.ic_lock, Tone.INFO, "Add your sharing link", "Your private link connects this phone to your match. Only you should have it.")
        if (MonitorState.recording == "on") {
            card.addView(errorLine("A match recording is running. Stop it from its notification first, then come back here."))
            return
        }
        card.addView(ui.primary("Paste my link", R.drawable.ic_arrow) { pasteFromClipboard() })
        val field = ui.input("…or paste the link here").apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
            isSaveEnabled = false
            setText(typed)
            (layoutParams as LinearLayout.LayoutParams).topMargin = ui.dp(14)
        }
        card.addView(field)
        card.addView(ui.ghost("Check link") {
            typed = field.text.toString()
            useText(typed)
        })
        error?.let { card.addView(errorLine(it)) }

        content.addView(ui.card().apply {
            addView(ui.heading("Where do I get the link?"))
            addView(howRow(1, "Check in for your match", "On the ArenaHub check-in page, finish your check-in."))
            addView(howRow(2, "Tap Open screen sharing", "The sharing page opens in your browser."))
            addView(howRow(3, "Tap Share with the Android Companion", "This opens this app with your link already filled in."))
            addView(howRow(4, "Or tap Copy private sharing link", "Then come back here and tap Paste my link."))
        })
    }

    private fun howRow(number: Int, title: String, detail: String) = ui.row(ui.text(number.toString(), 14f, ui.c.brandInk, 700).apply {
        gravity = Gravity.CENTER
        layoutParams = android.widget.FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER)
    }, ui.c.brand, title, detail)

    private fun errorLine(message: String) = ui.text(message, 14f, ui.c.bad, 500, top = 12, center = true).apply {
        accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
    }

    private fun pasteFromClipboard() {
        val clip = getSystemService(ClipboardManager::class.java).primaryClip
        val text = if (clip != null && clip.itemCount > 0) clip.getItemAt(0).coerceToText(this)?.toString().orEmpty() else ""
        if (text.isBlank()) {
            error = "Nothing is copied yet. On the ArenaHub sharing page, tap Copy private sharing link, then come back."
            return render()
        }
        typed = text
        useText(text)
    }

    private fun useText(text: String) {
        val parsed = parseLink(text)
        if (parsed == null) {
            error = if (text.contains("pov") || text.contains("join")) "That link has no sharing key. Use Copy private sharing link on the sharing page, not the address bar."
                else "That is not an ArenaHub sharing link. Use Copy private sharing link on the sharing page."
            return render()
        }
        checkLink(parsed)
    }

    private fun checkLink(next: Link) {
        if (!Api.validServer(next.server)) {
            error = "This link points to an unsupported server address (${next.server}). Ask your organizer for the tournament's HTTPS link."
            return go(Step.LINK)
        }
        error = null
        go(Step.CHECKING)
        scope.launch {
            val result = try { withContext(Dispatchers.IO) { Api.pov(next.server, "info", next.key) } } catch (_: Exception) { null }
            if (isFinishing || isDestroyed) return@launch
            val body = result?.json()
            when {
                result == null -> { error = "Could not reach ${Uri.parse(next.server).host}. Check your internet connection and try again."; go(Step.LINK) }
                !result.ok -> { error = result.error("This link is no longer valid.") + " Check in again to get a new link."; go(Step.LINK) }
                body?.optBoolean("ready") != true -> { error = "Live screens are not switched on for this event yet. Tell your organizer."; go(Step.LINK) }
                else -> { link = next; info = body; typed = ""; go(Step.MATCH) }
            }
        }
    }

    private fun matchStep() {
        val current = link
        val details = info
        if (current == null || details == null) return go(Step.LINK)
        val card = stepCard(R.drawable.ic_game, Tone.OK, details.optString("name").ifBlank { "Your match" }, listOf(details.optString("team"), details.optString("gameLabel")).filter { it.isNotBlank() }.joinToString(" · "))
        if (details.optString("match").isNotBlank()) card.addView(LinearLayout(this).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            addView(ui.pill(details.optString("match"), dot = ui.c.ok))
        })
        card.addView(ui.primary("Start broadcast", R.drawable.ic_video) { startBroadcast() })
        card.addView(ui.link("Use a different link") { link = null; info = null; go(Step.LINK) }.apply { gravity = Gravity.CENTER_HORIZONTAL })
        error?.let { card.addView(errorLine(it)) }

        content.addView(ui.card().apply {
            addView(ui.heading("Before you go live"))
            addView(ui.infoRow(R.drawable.ic_eye, "Only your match staff watch", "Other players and viewers cannot see your screen."))
            addView(ui.infoRow(R.drawable.ic_phone, "Choose \"Entire screen\"", "When Android asks, pick Entire screen, then Start. Sharing one app hides floating windows from the referee."))
            addView(ui.infoRow(R.drawable.ic_lock, "No sound, no camera", "Only the picture of your screen is sent."))
            addView(ui.infoRow(R.drawable.ic_power, "You end it", "Come back here or use the notification to end your live."))
            addView(ui.note(R.drawable.ic_server, ui.muted(Uri.parse(current.server).host.orEmpty(), 13.5f, top = 0)))
        })
    }

    private fun startBroadcast() {
        if (LiveShare.running) return go(Step.LIVE)
        if (MonitorState.recording == "on") { error = "A match recording is running. Stop it from its notification first."; return render() }
        error = null
        @Suppress("DEPRECATION")
        startActivityForResult(getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent(), REQUEST_CAPTURE)
    }

    @Deprecated("Platform activity result callback")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_CAPTURE) return
        val current = link
        if (resultCode != RESULT_OK || data == null || current == null) {
            error = "Sharing did not start because Android's screen share was cancelled. Tap Start broadcast and choose Entire screen."
            return go(if (current == null) Step.LINK else Step.MATCH)
        }
        go(Step.CONNECTING)
        scope.launch {
            try {
                val access = withContext(Dispatchers.IO) { Api.pov(current.server, "token", current.key) }
                val body = access.json()
                if (!access.ok) throw IllegalStateException(access.error("Sharing could not start."))
                // Start while this screen is visible: Android blocks starting screen capture from the background.
                LiveShare.start(this@PovActivity, body.getString("url"), body.getString("token"), data,
                    info?.optString("name").orEmpty(), info?.optString("match").orEmpty())
                go(Step.LIVE)
            } catch (failure: Exception) {
                error = (failure.message ?: "Sharing could not start.") + " Tap Start broadcast to try again."
                go(Step.MATCH)
            }
        }
    }

    private fun liveStep() {
        val card = ui.card(top = 0).apply { setPadding(ui.dp(20), ui.dp(26), ui.dp(20), ui.dp(22)) }
        content.addView(card)
        val dot = View(this).apply {
            background = android.graphics.drawable.GradientDrawable().apply { shape = android.graphics.drawable.GradientDrawable.OVAL; setColor(ui.c.bad) }
            layoutParams = LinearLayout.LayoutParams(ui.dp(12), ui.dp(12)).apply { marginEnd = ui.dp(8) }
        }
        card.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
            background = ui.shape(ui.c.soft(ui.c.bad, 0x22), 999); setPadding(ui.dp(16), ui.dp(8), ui.dp(16), ui.dp(8))
            addView(dot)
            addView(ui.text("LIVE", 15f, ui.c.bad, 800).apply { letterSpacing = 0.12f; layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT) })
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = ui.dp(14) }
        })
        pulse = ObjectAnimator.ofFloat(dot, View.ALPHA, 1f, 0.25f).apply {
            duration = 900; repeatMode = ValueAnimator.REVERSE; repeatCount = ValueAnimator.INFINITE; start()
        }
        timer = ui.text(elapsed(), 40f, ui.c.text, 700, center = true).apply { typeface = android.graphics.Typeface.create(android.graphics.Typeface.MONOSPACE, 700, false) }
        card.addView(timer)
        card.addView(ui.muted("Your match staff can see your screen.", 15f, top = 6, center = true))
        val who = listOf(LiveShare.who, LiveShare.match).filter { it.isNotBlank() }.joinToString(" · ")
        if (who.isNotBlank()) card.addView(ui.muted(who, 13.5f, top = 4, center = true))

        LiveShare.pausedNote?.let { note ->
            card.addView(LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                background = ui.shape(ui.c.soft(ui.c.warn, 0x26), 12, ui.c.warn); setPadding(ui.dp(14), ui.dp(12), ui.dp(14), ui.dp(12))
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = ui.dp(16) }
                addView(ui.text("The referee paused this match", 15f, ui.c.text, 700))
                addView(ui.muted((if (note.isNotBlank()) "$note\n" else "") + "Pause your game now. Keep sharing until the referee resumes.", 14f, top = 4))
            })
        }
        card.addView(ui.primary("Back to my game", R.drawable.ic_game) { moveTaskToBack(true) })
        card.addView(ui.danger("End live", R.drawable.ic_power) { confirmEnd() })

        content.addView(ui.card().apply {
            addView(ui.infoRow(R.drawable.ic_eye, "Keep this running while you play", "Your screen keeps sharing in the background. The notification shows it is on."))
            addView(ui.infoRow(R.drawable.ic_alert, "Notifications show too", "Turn on Do Not Disturb so private messages do not appear on the staff screen."))
        })
    }

    private fun confirmEnd() {
        AlertDialog.Builder(this).setTitle("End your live?")
            .setMessage("Match staff will stop seeing your screen. End it only when your match is over or the referee tells you to.")
            .setNegativeButton("Keep sharing", null)
            .setPositiveButton("End live") { _, _ ->
                LiveShare.stop(this)
                go(Step.ENDED)
            }.show()
    }

    private fun endedStep() {
        val card = stepCard(R.drawable.ic_check, Tone.OK, "Your live has ended", "Match staff no longer see your screen.")
        if (link != null && info != null) card.addView(ui.primary("Go live again", R.drawable.ic_video) { error = null; go(Step.MATCH) })
        card.addView(ui.ghost("Done") { finish() })
    }

    private fun waiting(title: String, text: String) { stepCard(null, Tone.INFO, title, text) }

    private fun elapsed(): String {
        val since = LiveShare.startedAt
        if (since == 0L) return "00:00"
        val seconds = ((System.currentTimeMillis() - since) / 1000).coerceAtLeast(0)
        val h = seconds / 3600; val m = (seconds % 3600) / 60; val s = seconds % 60
        return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%02d:%02d".format(m, s)
    }

    override fun onDestroy() {
        pulse?.cancel()
        handler.removeCallbacks(tick)
        scope.cancel()
        super.onDestroy()
    }
}
