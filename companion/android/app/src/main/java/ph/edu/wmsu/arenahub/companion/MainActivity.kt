package ph.edu.wmsu.arenahub.companion

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date
import kotlin.concurrent.thread

/**
 * The companion's screens: home, code check, consent, live scan status and the practice scan.
 * Monitoring itself runs in [MonitorService]; this screen only shows [MonitorState].
 */
class MainActivity : Activity() {
    private enum class Screen { HOME, LOOKUP, CONSENT, STARTING, MONITOR, PRACTICE, PRACTICE_RESULT, MESSAGE }
    private class Message(val tone: Tone, val title: String, val text: String)

    private lateinit var ui: Ui
    private lateinit var content: LinearLayout
    private lateinit var chip: TextView
    private lateinit var scroll: ScrollView
    private val handler = Handler(Looper.getMainLooper())

    private var screen = Screen.HOME
    private var server = ""
    private var code = ""
    private var editingServer = false
    private var formError: String? = null
    /** The code's player, match and settings, looked up before asking for consent. */
    private var pairing: JSONObject? = null
    private var claim: JSONObject? = null
    private var practiceGame = ""
    private var practiceResult: JSONObject? = null
    private var message: Message? = null
    private var shownKey = ""
    private var agoView: TextView? = null

    private val tick = object : Runnable {
        override fun run() { refreshLive(); handler.postDelayed(this, 1000) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        requestWindowFeature(Window.FEATURE_NO_TITLE)
        super.onCreate(savedInstanceState)
        val palette = Palette.of(this)
        ui = Ui(this, palette)
        server = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_SERVER, "") ?: ""

        // Draw behind the system bars on every version (Android 15 does this anyway) and pad for them here.
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false)
        @Suppress("DEPRECATION") run { window.statusBarColor = 0; window.navigationBarColor = 0 }
        window.decorView.setBackgroundColor(palette.bg)

        val page = ui.column().apply { layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT) }
        page.addView(header())
        content = ui.column()
        page.addView(content)
        scroll = ScrollView(this).apply { setBackgroundColor(palette.bg); isFillViewport = true; addView(page) }
        scroll.setOnApplyWindowInsetsListener { _, insets ->
            val (left, top, right, bottom) = if (Build.VERSION.SDK_INT >= 30) insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime()).let { listOf(it.left, it.top, it.right, it.bottom) }
                else @Suppress("DEPRECATION") listOf(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            page.setPadding(ui.dp(16) + left, ui.dp(12) + top, ui.dp(16) + right, ui.dp(28) + bottom)
            insets
        }
        setContentView(scroll)
        // Dark status bar icons on the light theme. Only valid once the window has its content.
        if (Build.VERSION.SDK_INT >= 30 && palette.bg != 0xFF0E0E10.toInt()) {
            val light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(light, light)
        }

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
        }
        if (MonitorState.running) go(Screen.MONITOR) else go(Screen.HOME)
        readLink(intent)
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); readLink(intent) }
    override fun onResume() { super.onResume(); handler.post(tick) }
    override fun onPause() { handler.removeCallbacks(tick); super.onPause() }

    @Deprecated("Platform Activity API; no AndroidX dependency in this app.")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        when (screen) {
            Screen.CONSENT, Screen.MESSAGE, Screen.PRACTICE_RESULT -> { MonitorState.ended = null; go(Screen.HOME) }
            Screen.MONITOR -> moveTaskToBack(true)
            else -> super.onBackPressed()
        }
    }

    /** arenahub://pair?s=<server>&c=<code> from the organizer's QR code, or arenahub://practice?s=<server>[&g=mlbb]. */
    private fun readLink(intent: Intent?) {
        val uri: Uri = intent?.data ?: return
        if (uri.scheme != "arenahub" || (uri.host != "pair" && uri.host != "practice")) return
        if (MonitorState.running) return go(Screen.MONITOR)
        uri.getQueryParameter("s")?.trim()?.trimEnd('/')?.let { address ->
            if (!Api.validServer(address)) {
                formError = "This link has an unsupported server address. Use the tournament’s HTTPS address."
                editingServer = true
                return go(Screen.HOME)
            }
            server = address
        }
        if (uri.host == "pair") {
            code = (uri.getQueryParameter("c") ?: "").uppercase()
            if (CODE.matches(code)) lookup() else go(Screen.HOME)
        } else choosePracticeGame(uri.getQueryParameter("g")?.takeIf { it in PRACTICE_GAMES.map { game -> game.second } })
    }

    // ---- Screens ----

    private fun go(next: Screen) {
        screen = next
        shownKey = ""
        agoView = null
        render()
        scroll.scrollTo(0, 0)
    }

    private fun render() {
        content.removeAllViews()
        chip.text = when (screen) {
            Screen.PRACTICE, Screen.PRACTICE_RESULT -> "Practice scan"
            Screen.HOME, Screen.MESSAGE -> "This phone"
            else -> "Match scan"
        }
        when (screen) {
            Screen.HOME -> home()
            Screen.LOOKUP -> hero(null, Tone.INFO, "Checking your scan code", server)
            Screen.CONSENT -> consent()
            Screen.STARTING -> hero(null, Tone.INFO, "Starting your scan", if (pairing?.optBoolean("record") == true) "Android will ask to record your screen. Choose Entire screen, then Start." else "This takes a few seconds.")
            Screen.MONITOR -> monitor()
            Screen.PRACTICE -> hero(null, Tone.INFO, "Checking this phone", "Apps, your game install and device settings. This takes a few seconds.")
            Screen.PRACTICE_RESULT -> practiceResult()
            Screen.MESSAGE -> message?.let { m ->
                hero(m.tone.icon(), m.tone, m.title, m.text)
                content.addView(ui.primary("Back to start") { MonitorState.ended = null; go(Screen.HOME) })
            }
        }
    }

    private fun header() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        setPadding(0, ui.dp(8), 0, ui.dp(10))
        addView(ImageView(context).apply { setImageResource(R.drawable.ic_logo); layoutParams = LinearLayout.LayoutParams(ui.dp(26), ui.dp(26)).apply { marginEnd = ui.dp(10) } })
        addView(ui.text("ArenaHub Anti-cheat", 16f, ui.c.text, 700).apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) })
        chip = ui.text("This phone", 12f, ui.c.muted, 600).apply {
            background = ui.shape(0x00000000, 999, ui.c.lineStrong); setPadding(ui.dp(10), ui.dp(3), ui.dp(10), ui.dp(3))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        addView(chip)
    }

    /** The big centred status card at the top of most screens. A null icon shows a spinner. */
    private fun hero(iconRes: Int?, tone: Tone, title: String, text: String?, extra: View? = null) {
        content.addView(ui.card(top = 6).apply {
            setPadding(ui.dp(20), ui.dp(30), ui.dp(20), ui.dp(26))
            addView(ui.badge(iconRes, tone))
            addView(ui.title(title, center = true, size = 26f))
            if (!text.isNullOrBlank()) addView(ui.muted(text, 15f, top = 8, center = true))
            if (extra != null) addView(extra)
        })
    }

    private fun home() {
        content.addView(ui.title("Scan before you play").apply { setPadding(0, ui.dp(10), 0, 0) })
        content.addView(ui.muted("Scan the QR code from your organizer, or type the 8-character scan code for your match.", 15f))

        lateinit var codeField: EditText
        var serverField: EditText? = null
        content.addView(ui.card().apply {
            addView(ui.heading("Match scan"))
            addView(ui.label("Scan code", top = 0))
            codeField = ui.input("ABCD2345", code = true).apply { setText(code) }
            addView(codeField)
            if (server.isBlank() || editingServer) {
                addView(ui.label("Tournament server"))
                serverField = ui.input("https://...").apply { setText(server) }
                addView(serverField)
                addView(ui.muted("It is on your organizer's QR code or the ArenaHub Anti-cheat page.", 12.5f))
            } else {
                addView(ui.note(R.drawable.ic_server, ui.column().apply {
                    addView(ui.text("Tournament server", 12.5f, ui.c.muted))
                    addView(ui.text(server, 14f, ui.c.text, 600))
                }))
                addView(ui.link("Change server") { code = codeField.text.toString(); editingServer = true; go(Screen.HOME) })
            }
            formError?.let { addView(ui.text(it, 14f, ui.c.bad, 600, top = 10)) }
            addView(ui.primary("Continue", R.drawable.ic_arrow) {
                code = codeField.text.toString().trim().uppercase()
                serverField?.let { server = it.text.toString().trim().trimEnd('/') }
                formError = when {
                    !CODE.matches(code) -> "Enter the 8-character scan code from your organizer."
                    !Api.validServer(server) -> "Enter the tournament server address, starting with https://"
                    else -> null
                }
                if (formError != null) go(Screen.HOME) else { editingServer = false; lookup() }
            }.apply { (layoutParams as LinearLayout.LayoutParams).topMargin = ui.dp(16) })
        })

        content.addView(ui.ghost("Share game screen", R.drawable.ic_video) {
            startActivity(Intent(this, PovActivity::class.java))
        })
        content.addView(ui.card().apply {
            addView(ui.row(ui.icon(R.drawable.ic_shield, ui.c.brandInk), ui.c.brand, "Practice scan", "Check this phone now, with no code. Nothing is saved and it does not count for a match."))
            addView(ui.ghost("Start practice scan") {
                serverField?.let { field -> field.text.toString().trim().trimEnd('/').takeIf { it.isNotBlank() }?.let { server = it } }
                choosePracticeGame()
            })
        })
    }

    private fun lookup() {
        formError = null
        go(Screen.LOOKUP)
        thread {
            val result = try { Api.getJson(server, "/device/pairing/$code") } catch (_: Exception) { null }
            runOnUiThread {
                val body = result?.json()
                when {
                    result == null -> say(Tone.BAD, "Cannot reach the server", "Check your Wi-Fi or mobile data, and that the server address is right:\n$server")
                    !result.ok -> say(Tone.BAD, "This code cannot be used", result.error("Ask your organizer for a new scan code."))
                    // "any": staff did not pick a device, so this Android phone takes it.
                    body?.optString("platform") != "android" && body?.optString("platform") != "any" -> say(Tone.WARN, "This code is for another device", if (body?.optString("platform") == "pc") "Open it on the PC you play on, with the ArenaHub agent." else "Open it in Safari on the iPhone you play on.")
                    else -> { pairing = body; go(Screen.CONSENT) }
                }
            }
        }
    }

    private fun consent() {
        val info = pairing ?: return go(Screen.HOME)
        val card = ui.card(top = 6)
        card.addView(ui.title("Scan for ${info.optString("playerName").ifBlank { "this player" }}"))
        card.addView(ui.muted(listOf(info.optString("matchLabel"), info.optString("gameLabel")).filter { it.isNotBlank() }.joinToString(" · "), 15f))
        card.addView(ui.heading("This scan checks", top = 20))
        card.addView(ui.infoRow(R.drawable.ic_phone, "Apps on this phone", "Compared with the tournament's restricted list on your phone. Only matches are sent, never your app list."))
        card.addView(ui.infoRow(R.drawable.ic_badge, "Your game install", "The game's signing certificate and where it was installed from, so a modded copy is caught."))
        card.addView(ui.infoRow(R.drawable.ic_shield_alert, "Root and modding tools", "Root, Shizuku, cloned or virtual spaces, screen-control and overlay apps, and debugging settings."))
        if (info.optBoolean("record")) card.addView(ui.infoRow(R.drawable.ic_video, "Screen recording", "Your screen only, never the microphone or camera. Close private apps first."))
        card.addView(ui.note(R.drawable.ic_lock, ui.muted("Never touched: your messages, photos, contacts, location and passwords. A referee, not software, decides any outcome.", 13.5f, top = 0)))
        card.addView(ui.note(R.drawable.ic_server, ui.column().apply {
            addView(ui.text("Results go to", 12.5f, ui.c.muted))
            addView(ui.text(server, 14f, ui.c.text, 600))
            addView(ui.text("Check this address with your referee before you agree.", 12.5f, ui.c.muted))
        }, top = 10))
        card.addView(ui.primary("Agree and start scan", R.drawable.ic_shield) { start() }.apply { (layoutParams as LinearLayout.LayoutParams).topMargin = ui.dp(18) })
        card.addView(ui.ghost("Decline") { decline() })
        card.addView(ui.link("Read the full monitoring notice") {
            AlertDialog.Builder(this).setTitle("Monitoring notice").setMessage(getString(R.string.consent)).setPositiveButton("Close", null).show()
        })
        content.addView(card)
    }

    private fun monitor() {
        if (!MonitorState.running) {
            val ended = MonitorState.ended
            if (ended != null) { message = Message(Tone.INFO, "Scan stopped", "$ended Ask your referee for a new code if you need to scan again."); return go(Screen.MESSAGE) }
            return go(Screen.HOME)
        }
        val scan = MonitorState.scan
        val match = MonitorState.matchLabel
        val tone = scan?.tone ?: Tone.INFO
        val text = when {
            scan == null -> "Checking apps, your game install and device settings. This takes a few seconds."
            scan.status == "ready" -> "You are clear to play${if (match.isNotBlank()) " $match" else ""}. Keep this app running until your match ends. Stopping it tells the referee."
            scan.status == "blocked" -> "Uninstall or turn off what is listed below. The scan checks again by itself, so you do not need to restart it. If something is wrongly flagged, show this screen to the referee."
            else -> scan.detail
        }
        val pills = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, ui.dp(8), 0, 0)
            val live = ui.pill(liveText(), dot = if (MonitorState.problem == null) ui.c.ok else ui.c.bad)
            agoView = (live.getChildAt(live.childCount - 1) as TextView)
            addView(live)
            if (MonitorState.expiresAt > 0) addView(ui.pill("Until ${DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(MonitorState.expiresAt))}", iconRes = R.drawable.ic_clock))
        }
        val who = listOf(MonitorState.playerName, match).filter { it.isNotBlank() }.joinToString(" · ")
        hero(if (scan == null || scan.status == "scanning") null else tone.icon(), tone, scan?.label ?: "Scanning this phone", text, ui.column().apply {
            addView(pills)
            if (who.isNotBlank()) addView(ui.muted(who, 13f, top = 12, center = true))
        })
        MonitorState.problem?.let { problem -> content.addView(ui.note(R.drawable.ic_alert, ui.text(problem, 14f, ui.c.bad, 500))) }
        if (scan != null && scan.blockers.isNotEmpty()) content.addView(ui.card().apply { addView(ui.heading("Blocking your match")); scan.blockers.forEach { addView(ui.finding(it, soft = false)) } })
        if (scan != null && scan.warnings.isNotEmpty()) content.addView(ui.card().apply {
            addView(ui.heading("Worth knowing")); addView(ui.muted("These do not stop you from playing.", 13f, top = 0)); scan.warnings.forEach { addView(ui.finding(it, soft = true)) }
        })
        content.addView(ui.card().apply {
            addView(ui.heading("This session"))
            addView(ui.ghost("Share game screen", R.drawable.ic_video) {
                startActivity(Intent(this@MainActivity, PovActivity::class.java))
            })
            addView(ui.infoRow(R.drawable.ic_video, "Screen recording", when (MonitorState.recording) {
                "on" -> "On. Your screen is recorded for the referee."
                "refused" -> "You did not allow it. The referee has been told."
                "stopped" -> "Android stopped the recording. The referee will see this."
                else -> "Off. The referee did not ask for it."
            }))
            if (MonitorState.pendingUploads > 0) addView(ui.infoRow(R.drawable.ic_refresh, "Recordings waiting to upload", "${MonitorState.pendingUploads}. They send by themselves when the connection is back."))
            if (!DeviceChecks(this@MainActivity).hasUsageAccess()) {
                addView(ui.infoRow(R.drawable.ic_eye, "Optional: app on screen", "Lets the referee see that the game was the app in front. You can skip this."))
                addView(ui.ghost("Allow usage access") { startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) })
            }
        })
        content.addView(ui.danger("Stop scan", R.drawable.ic_power) {
            AlertDialog.Builder(this).setTitle("Stop the scan?").setMessage("The referee will be told, and you will need a new code to scan again.")
                .setNegativeButton("Keep scanning", null).setPositiveButton("Stop") { _, _ -> MonitorService.stop(this) }.show()
        }.apply { (layoutParams as LinearLayout.LayoutParams).topMargin = ui.dp(18) })
        content.addView(ui.muted("Stopping before the match ends is reported to the referee.", 13f, top = 10, center = true))
        shownKey = monitorKey()
    }

    private fun practiceResult() {
        val result = practiceResult ?: return go(Screen.HOME)
        val view = ScanView.from(result) ?: ScanView("incomplete", result.optString("label", "Practice result"), result.optString("detail"), emptyList(), emptyList())
        val game = PRACTICE_GAMES.firstOrNull { it.second == practiceGame }?.first
        hero(view.tone.icon(), view.tone, view.label, view.detail, game?.let { ui.muted("Checked for $it against the lists from $server.", 13f, top = 12, center = true) })
        if (view.blockers.isNotEmpty()) content.addView(ui.card().apply { addView(ui.heading("Found on this phone")); view.blockers.forEach { addView(ui.finding(it, soft = false)) } })
        if (view.warnings.isNotEmpty()) content.addView(ui.card().apply { addView(ui.heading("Review notes")); view.warnings.forEach { addView(ui.finding(it, soft = true)) } })
        content.addView(ui.primary("Scan again", R.drawable.ic_refresh) { runPractice(practiceGame) }.apply { (layoutParams as LinearLayout.LayoutParams).topMargin = ui.dp(18) })
        content.addView(ui.ghost("Done") { go(Screen.HOME) })
        result.optString("note").takeIf { it.isNotBlank() }?.let { content.addView(ui.muted(it, 13f, top = 14, center = true)) }
    }

    private fun say(tone: Tone, title: String, text: String) { message = Message(tone, title, text); go(Screen.MESSAGE) }

    // ---- Live status ----

    private fun liveText(): String {
        if (MonitorState.problem != null) return "Reconnecting"
        val last = MonitorState.lastReport
        if (last == 0L) return "Starting"
        val seconds = ((System.currentTimeMillis() - last) / 1000).coerceAtLeast(0)
        return "Live · checked ${if (seconds < 5) "just now" else "$seconds s ago"}"
    }
    private fun monitorKey() = listOf(MonitorState.running, MonitorState.scan, MonitorState.problem, MonitorState.recording, MonitorState.pendingUploads, MonitorState.ended, DeviceChecks(this).hasUsageAccess()).toString()
    private fun refreshLive() {
        if (screen == Screen.STARTING && MonitorState.running) return go(Screen.MONITOR)
        if (screen != Screen.MONITOR) return
        if (monitorKey() != shownKey) { val y = scroll.scrollY; render(); scroll.post { scroll.scrollTo(0, y) } }
        else agoView?.text = liveText()
    }

    // ---- Practice scan: no code, nothing stored, never counts for a match ----

    private fun choosePracticeGame(game: String? = null) {
        if (MonitorState.running) return go(Screen.MONITOR)
        if (!Api.validServer(server)) { formError = "Enter the tournament server address first. It is on the ArenaHub Anti-cheat page."; editingServer = true; return go(Screen.HOME) }
        if (game != null) return runPractice(game)
        AlertDialog.Builder(this)
            .setTitle("Which game do you play?")
            .setItems(PRACTICE_GAMES.map { it.first }.toTypedArray()) { _, which -> runPractice(PRACTICE_GAMES[which].second) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun runPractice(game: String) {
        practiceGame = game
        go(Screen.PRACTICE)
        val target = server
        thread {
            val outcome = try {
                val policy = Api.postJson(target, "/practice/policy", JSONObject().put("game", game))
                val lists = policy.json().optJSONObject("monitor")
                if (!policy.ok || lists == null || (lists.optJSONArray("gamePackages")?.length() ?: 0) == 0) {
                    Result.failure(Exception(policy.error("This server did not supply the game scan policy. Check the tournament server address.")))
                }
                else {
                    val facts = DeviceChecks(this).collect(lists.optJSONArray("gamePackages").strings(), lists.optJSONArray("blockedPackages").strings(), recording = false, recordingRefused = false, blockedCertificates = lists.optJSONArray("blockedCertificates").strings())
                    val check = Api.postJson(target, "/practice/check", JSONObject().put("game", game).put("facts", facts))
                    val result = check.json()
                    if (check.ok && ScanView.from(result)?.status in setOf("ready", "blocked", "incomplete")) {
                        rememberServer(target)
                        Result.success(result)
                    } else Result.failure(Exception(check.error("The server did not return a practice result. Try again.")))
                }
            } catch (_: Exception) { Result.failure(Exception("Cannot reach $target. Check your internet connection and the address.")) }
            runOnUiThread {
                if (screen != Screen.PRACTICE || target != server || practiceGame != game) return@runOnUiThread
                outcome.onFailure { say(Tone.BAD, "Practice scan failed", it.message ?: "The practice scan failed.") }
                outcome.onSuccess { practiceResult = it; go(Screen.PRACTICE_RESULT) }
            }
        }
    }

    // ---- Official scan ----

    private fun start() {
        if (MonitorState.running) return go(Screen.MONITOR)
        go(Screen.STARTING)
        thread {
            val device = JSONObject().put("model", "${Build.MANUFACTURER} ${Build.MODEL}".take(80)).put("os", "Android ${Build.VERSION.RELEASE}").put("agent", "android 3.3.0")
            val result = try { Api.postJson(server, "/device/claim", JSONObject().put("code", code).put("device", device)) } catch (_: Exception) { null }
            runOnUiThread {
                when {
                    result == null -> say(Tone.BAD, "Cannot reach the server", "Check your Wi-Fi or mobile data, then scan the QR code again.")
                    !result.ok -> say(Tone.BAD, "The scan could not start", result.error("Pairing failed (${result.code}). Ask your organizer for a new code."))
                    else -> {
                        claim = result.json(); rememberServer(server)
                        val body = claim!!
                        if (body.optBoolean("record", true)) {
                            val projection = getSystemService(MediaProjectionManager::class.java)
                            @Suppress("DEPRECATION")
                            startActivityForResult(projection.createScreenCaptureIntent(), REQUEST_CAPTURE)
                        } else startService(body, RESULT_CANCELED, null)
                    }
                }
            }
        }
    }

    private fun decline() {
        AlertDialog.Builder(this)
            .setTitle("Decline the scan?")
            .setMessage("The referee will be told and will arrange an organizer device or watch your match in person. Declining is not a penalty.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Decline") { _, _ ->
                go(Screen.LOOKUP)
                thread {
                    val result = try { Api.postJson(server, "/device/decline", JSONObject().put("code", code)) } catch (_: Exception) { null }
                    runOnUiThread {
                        when {
                            result == null -> say(Tone.BAD, "Your answer was not sent", "Cannot reach the server. Tell the referee you declined.")
                            !result.ok -> say(Tone.BAD, "Your answer was not sent", result.error("Could not send your answer (${result.code})."))
                            else -> { code = ""; say(Tone.WARN, "You declined", "The referee has been told. Go to the referee desk before your match.") }
                        }
                    }
                }
            }
            .show()
    }

    /** Starts the service. Recording is only requested when the referee turned it on for this match. */
    private fun startService(body: JSONObject, resultCode: Int, data: Intent?) {
        val monitor = body.optJSONObject("monitor") ?: JSONObject()
        val service = Intent(this, MonitorService::class.java)
            .putExtra(MonitorService.EXTRA_SERVER, server)
            .putExtra(MonitorService.EXTRA_TOKEN, body.getString("token"))
            .putStringArrayListExtra(MonitorService.EXTRA_GAMES, monitor.optJSONArray("gamePackages").strings())
            .putStringArrayListExtra(MonitorService.EXTRA_BLOCKED, monitor.optJSONArray("blockedPackages").strings())
            .putStringArrayListExtra(MonitorService.EXTRA_CERTIFICATES, monitor.optJSONArray("blockedCertificates").strings())
            .putExtra(MonitorService.EXTRA_EXPIRES, body.optLong("expiresAt", 0))
            .putExtra(MonitorService.EXTRA_SCAN, monitor.optJSONObject("scan")?.toString())
            .putExtra(MonitorService.EXTRA_HEARTBEAT, body.optInt("heartbeatSeconds", 15))
            .putExtra(MonitorService.EXTRA_RECORD, body.optBoolean("record", true))
            .putExtra(MonitorService.EXTRA_PROJECTION_CODE, resultCode)
            .putExtra(MonitorService.EXTRA_PLAYER, body.optString("playerName"))
            .putExtra(MonitorService.EXTRA_MATCH, body.optString("matchLabel"))
        if (resultCode == RESULT_OK && data != null) service.putExtra(MonitorService.EXTRA_PROJECTION_DATA, data)
        startForegroundService(service)
        claim = null
        code = ""
        // The service flips MonitorState.running a moment later; the 1-second tick then opens the live screen.
    }

    @Deprecated("Platform Activity API; no AndroidX dependency in this app.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_CAPTURE) return
        val body = claim ?: return
        // Monitoring starts even if recording is refused; the referee is told "screen recording refused".
        startService(body, resultCode, data)
    }

    private fun rememberServer(value: String) = getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_SERVER, value).apply()
    private fun JSONArray?.strings(): ArrayList<String> = ArrayList(if (this == null) emptyList() else (0 until length()).map { getString(it) })
    private fun Tone.icon() = when (this) { Tone.OK -> R.drawable.ic_check; Tone.BAD -> R.drawable.ic_x; Tone.WARN -> R.drawable.ic_alert; Tone.INFO -> R.drawable.ic_power }

    companion object {
        const val REQUEST_CAPTURE = 41
        const val REQUEST_NOTIFICATIONS = 42
        const val PREFS = "arenahub"
        const val KEY_SERVER = "server"
        private val CODE = Regex("^[A-Z2-9]{8}$")
        /** CODM Battle Royale and Multiplayer are the same app, so one practice choice covers both. */
        val PRACTICE_GAMES = listOf("Mobile Legends" to "mlbb", "Call of Duty: Mobile" to "codm-mp")
    }
}
