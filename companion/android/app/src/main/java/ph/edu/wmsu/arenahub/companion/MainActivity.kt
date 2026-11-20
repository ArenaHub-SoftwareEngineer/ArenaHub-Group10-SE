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
import android.text.InputType
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date
import kotlin.concurrent.thread

/** Pairing, consent and status screen. Monitoring itself runs in [MonitorService]. */
class MainActivity : Activity() {
    private lateinit var serverField: EditText
    private lateinit var codeField: EditText
    private lateinit var startButton: Button
    private lateinit var declineButton: Button
    private lateinit var stopButton: Button
    private lateinit var usageButton: Button
    private lateinit var practiceButton: Button
    private lateinit var status: TextView
    private val ui = Handler(Looper.getMainLooper())
    private var claim: JSONObject? = null
    private var claimServer = ""

    private val refresh = object : Runnable {
        override fun run() { render(); ui.postDelayed(this, 1000) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad) }
        fun text(value: String, size: Float = 15f) = TextView(this).apply { text = value; textSize = size; setPadding(0, pad / 2, 0, pad / 2) }

        column.addView(text("ArenaHub Anti-cheat", 22f))
        column.addView(text("Ask the referee for the pairing QR code. Scanning it with your camera opens this app with everything filled in."))
        serverField = EditText(this).apply { hint = "Address from the referee, e.g. https://....trycloudflare.com"; inputType = InputType.TYPE_TEXT_VARIATION_URI; isSingleLine = true }
        codeField = EditText(this).apply { hint = "8-character match scan code"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS; isSingleLine = true }
        column.addView(serverField)
        column.addView(codeField)
        column.addView(text(getString(R.string.consent), 14f))
        column.addView(text("A passing scan is required before joining. Tapping Agree and start scan means you agree to the monitoring above for this match. You can decline or stop at any time.", 13f))
        startButton = Button(this).apply { text = "Agree and start scan"; setOnClickListener { start() } }
        declineButton = Button(this).apply { text = "Decline scan"; setOnClickListener { decline() } }
        stopButton = Button(this).apply { text = "Stop scan"; setOnClickListener { MonitorService.stop(this@MainActivity) } }
        usageButton = Button(this).apply {
            text = "Optional: allow app usage access"
            setOnClickListener { startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) }
        }
        status = text("", 15f)
        column.addView(startButton)
        column.addView(declineButton)
        column.addView(stopButton)
        column.addView(usageButton)
        column.addView(text("Usage access lets the referee see whether the game was the app on screen. It is optional.", 13f))
        column.addView(text("Before match day", 18f))
        column.addView(text("A practice scan checks this phone now, with no code, so you can fix problems before your match. It sends what it finds to the tournament server once to get the result. Nothing is saved, nothing is recorded, and it does not count for a match.", 13f))
        practiceButton = Button(this).apply { text = "Practice scan (no code needed)"; setOnClickListener { choosePracticeGame() } }
        column.addView(practiceButton)
        column.addView(status)
        setContentView(ScrollView(this).apply { addView(column) })

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
        }
        // The last server that worked, so the player never types it twice. A link below replaces it.
        if (serverField.text.isBlank()) serverField.setText(getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_SERVER, "") ?: "")
        readPairingLink(intent)
    }

    private fun rememberServer(server: String) = getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_SERVER, server).apply()

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        readPairingLink(intent)
    }

    override fun onResume() { super.onResume(); ui.post(refresh) }
    override fun onPause() { ui.removeCallbacks(refresh); super.onPause() }

    /** arenahub://pair?s=<laptop address>&c=<code> from the referee's QR code, or arenahub://practice?s=<server>. */
    private fun readPairingLink(intent: Intent?) {
        val uri: Uri = intent?.data ?: return
        if (uri.scheme != "arenahub" || (uri.host != "pair" && uri.host != "practice")) return
        uri.getQueryParameter("s")?.let { serverField.setText(it) }
        if (uri.host == "pair") uri.getQueryParameter("c")?.let { codeField.setText(it) }
        // arenahub://practice?s=<server>&g=mlbb starts the practice scan straight away; without g, the player picks.
        else choosePracticeGame(uri.getQueryParameter("g")?.takeIf { it in PRACTICE_GAMES.map { game -> game.second } })
    }

    // ---- Practice scan: no code, nothing stored, never counts for a match ----

    private fun choosePracticeGame(game: String? = null) {
        if (MonitorState.running) return show("The official scan is running. A practice scan is for before match day.")
        val server = serverField.text.toString().trim().trimEnd('/')
        if (!Api.validServer(server)) return show("Enter the tournament server address above first. It is on the ArenaHub Anti-cheat page.")
        if (game != null) return runPractice(server, game)
        AlertDialog.Builder(this)
            .setTitle("Practice scan: which game?")
            .setItems(PRACTICE_GAMES.map { it.first }.toTypedArray()) { _, which -> runPractice(server, PRACTICE_GAMES[which].second) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun runPractice(server: String, game: String) {
        practiceButton.isEnabled = false
        show("Practice scan: checking this phone...")
        thread {
            val outcome = try {
                val policy = Api.postJson(server, "/practice/policy", JSONObject().put("game", game))
                if (!policy.ok) Result.failure(Exception(policy.error("The server could not start a practice scan (${policy.code}).")))
                else {
                    val lists = policy.json().optJSONObject("monitor") ?: JSONObject()
                    // The same checks as the official scan, with recording off.
                    val facts = DeviceChecks(this).collect(lists.optJSONArray("gamePackages").strings(), lists.optJSONArray("blockedPackages").strings(), recording = false, recordingRefused = false, blockedCertificates = lists.optJSONArray("blockedCertificates").strings())
                    val check = Api.postJson(server, "/practice/check", JSONObject().put("game", game).put("facts", facts))
                    if (check.ok) { rememberServer(server); Result.success(check.json()) } else Result.failure(Exception(check.error("The practice check failed (${check.code}).")))
                }
            } catch (_: Exception) { Result.failure(Exception("Cannot reach $server. Check your internet connection and the address.")) }
            runOnUiThread {
                practiceButton.isEnabled = true
                outcome.onFailure { show(it.message ?: "The practice scan failed.") }
                outcome.onSuccess { showPracticeResult(it) }
            }
        }
    }

    private fun showPracticeResult(result: JSONObject) {
        val label = result.optString("label", "Practice result")
        val message = buildString {
            append(result.optString("detail"))
            val blockers = result.optJSONArray("blockers").strings()
            val warnings = result.optJSONArray("warnings").strings()
            if (blockers.isNotEmpty()) append("\n\nFix these before match day:\n").append(blockers.joinToString("\n") { "• $it" })
            if (warnings.isNotEmpty()) append("\n\nWorth knowing (these do not stop you):\n").append(warnings.joinToString("\n") { "• $it" })
            append("\n\n").append(result.optString("note"))
        }
        show("Practice result: $label")
        AlertDialog.Builder(this).setTitle(label).setMessage(message).setPositiveButton("OK", null).show()
    }

    private fun start() {
        val server = serverField.text.toString().trim().trimEnd('/')
        val code = codeField.text.toString().trim().uppercase()
        when {
            MonitorState.running -> return show("Monitoring is already on.")
            !Api.validServer(server) -> return show("Enter the laptop address shown on the referee screen.")
            !Regex("^[A-Z0-9]{8}$").matches(code) -> return show("Enter the 8-character match scan code.")
        }
        startButton.isEnabled = false
        show("Connecting to the tournament server...")
        thread {
                val device = JSONObject().put("model", "${Build.MANUFACTURER} ${Build.MODEL}".take(80)).put("os", "Android ${Build.VERSION.RELEASE}").put("agent", "android 3.2.0")
            val result = try { Api.postJson(server, "/device/claim", JSONObject().put("code", code).put("device", device)) } catch (_: Exception) { null }
            runOnUiThread {
                startButton.isEnabled = true
                when {
                    result == null -> show("Cannot reach $server. Check your internet connection and the address.")
                    !result.ok -> show(result.error("Pairing failed (${result.code})."))
                    else -> {
                        claim = result.json(); claimServer = server; rememberServer(server)
                        val body = claim!!
                        if (body.optBoolean("record", true)) {
                            show("Paired: ${body.optString("playerName")} - ${body.optString("matchLabel")}. Android will now ask to record your screen; choose the entire screen.")
                            val projection = getSystemService(MediaProjectionManager::class.java)
                            @Suppress("DEPRECATION")
                            startActivityForResult(projection.createScreenCaptureIntent(), REQUEST_CAPTURE)
                        } else {
                            show("Paired: ${body.optString("playerName")} - ${body.optString("matchLabel")}. The referee did not ask for screen recording, so only device checks run.")
                            startService(body, RESULT_CANCELED, null)
                        }
                    }
                }
            }
        }
    }

    private fun decline() {
        val server = serverField.text.toString().trim().trimEnd('/')
        val code = codeField.text.toString().trim().uppercase()
        if (!Api.validServer(server) || !Regex("^[A-Z0-9]{8}$").matches(code)) return show("Enter the laptop address and pairing code first, so the referee knows who declined.")
        AlertDialog.Builder(this)
            .setTitle("Decline scan?")
            .setMessage("The referee will be told and will arrange an organizer device or watch your match in person.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Decline") { _, _ ->
                declineButton.isEnabled = false
                thread {
                    val result = try { Api.postJson(server, "/device/decline", JSONObject().put("code", code)) } catch (_: Exception) { null }
                    runOnUiThread {
                        declineButton.isEnabled = true
                        when {
                            result == null -> show("Cannot reach $server. Check your internet connection and try again.")
                            !result.ok -> show(result.error("Could not send your answer (${result.code})."))
                            else -> { codeField.setText(""); show("You declined. The referee has been told. Please go to the referee desk before your match.") }
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
            .putExtra(MonitorService.EXTRA_SERVER, claimServer)
            .putExtra(MonitorService.EXTRA_TOKEN, body.getString("token"))
            .putStringArrayListExtra(MonitorService.EXTRA_GAMES, monitor.optJSONArray("gamePackages").strings())
            .putStringArrayListExtra(MonitorService.EXTRA_BLOCKED, monitor.optJSONArray("blockedPackages").strings())
            .putStringArrayListExtra(MonitorService.EXTRA_CERTIFICATES, monitor.optJSONArray("blockedCertificates").strings())
            .putExtra(MonitorService.EXTRA_EXPIRES, body.optLong("expiresAt", 0))
            .putExtra(MonitorService.EXTRA_SCAN, monitor.optJSONObject("scan")?.toString())
            .putExtra(MonitorService.EXTRA_HEARTBEAT, body.optInt("heartbeatSeconds", 15))
            .putExtra(MonitorService.EXTRA_RECORD, body.optBoolean("record", true))
            .putExtra(MonitorService.EXTRA_PROJECTION_CODE, resultCode)
        if (resultCode == RESULT_OK && data != null) service.putExtra(MonitorService.EXTRA_PROJECTION_DATA, data)
        startForegroundService(service)
        claim = null
        codeField.setText("")
    }

    @Deprecated("Platform Activity API; no AndroidX dependency in this app.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_CAPTURE) return
        val body = claim ?: return
        // Monitoring starts even if recording is refused; the referee is told "screen recording refused".
        if (resultCode != RESULT_OK || data == null) show("You did not allow screen recording. Device checks still run, and the referee has been told.")
        startService(body, resultCode, data)
    }

    private fun render() {
        val running = MonitorState.running
        startButton.visibility = if (running) View.GONE else View.VISIBLE
        declineButton.visibility = if (running) View.GONE else View.VISIBLE
        stopButton.visibility = if (running) View.VISIBLE else View.GONE
        usageButton.visibility = if (DeviceChecks(this).hasUsageAccess()) View.GONE else View.VISIBLE
        if (running || MonitorState.lastReport > 0) {
            val last = if (MonitorState.lastReport > 0) DateFormat.getTimeInstance().format(Date(MonitorState.lastReport)) else "not yet"
            status.text = "${MonitorState.status}\nLast report: $last\nRecordings waiting to upload: ${MonitorState.pendingUploads}"
        }
    }

    private fun show(message: String) { status.text = message }

    private fun JSONArray?.strings(): ArrayList<String> = ArrayList(if (this == null) emptyList() else (0 until length()).map { getString(it) })

    companion object {
        const val REQUEST_CAPTURE = 41
        const val REQUEST_NOTIFICATIONS = 42
        const val PREFS = "arenahub"
        const val KEY_SERVER = "server"
        /** CODM Battle Royale and Multiplayer are the same app, so one practice choice covers both. */
        val PRACTICE_GAMES = listOf("Mobile Legends" to "mlbb", "Call of Duty: Mobile" to "codm-mp")
    }
}
