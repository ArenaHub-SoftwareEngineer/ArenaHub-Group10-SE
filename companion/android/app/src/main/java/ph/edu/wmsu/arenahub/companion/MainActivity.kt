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
import android.widget.CheckBox
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
    private lateinit var consent: CheckBox
    private lateinit var startButton: Button
    private lateinit var declineButton: Button
    private lateinit var stopButton: Button
    private lateinit var usageButton: Button
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

        column.addView(text("ArenaHub Match Monitor", 22f))
        column.addView(text("Ask the referee for the pairing QR code. Scanning it with your camera opens this app with everything filled in."))
        serverField = EditText(this).apply { hint = "Address from the referee, e.g. https://....trycloudflare.com"; inputType = InputType.TYPE_TEXT_VARIATION_URI; isSingleLine = true }
        codeField = EditText(this).apply { hint = "8-character pairing code"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS; isSingleLine = true }
        column.addView(serverField)
        column.addView(codeField)
        column.addView(text(getString(R.string.consent), 14f))
        consent = CheckBox(this).apply { text = "I understand and agree to monitoring for this match" }
        column.addView(consent)
        column.addView(text("Declining is allowed and is not a penalty. The referee is told and will give you an organizer device or watch you in person.", 13f))
        startButton = Button(this).apply { text = "Agree and start monitoring"; setOnClickListener { start() } }
        declineButton = Button(this).apply { text = "Decline monitoring"; setOnClickListener { decline() } }
        stopButton = Button(this).apply { text = "Stop monitoring"; setOnClickListener { MonitorService.stop(this@MainActivity) } }
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
        column.addView(status)
        setContentView(ScrollView(this).apply { addView(column) })

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
        }
        readPairingLink(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        readPairingLink(intent)
    }

    override fun onResume() { super.onResume(); ui.post(refresh) }
    override fun onPause() { ui.removeCallbacks(refresh); super.onPause() }

    /** arenahub://pair?s=<laptop address>&c=<code> from the referee's QR code. */
    private fun readPairingLink(intent: Intent?) {
        val uri: Uri = intent?.data ?: return
        if (uri.scheme != "arenahub" || uri.host != "pair") return
        uri.getQueryParameter("s")?.let { serverField.setText(it) }
        uri.getQueryParameter("c")?.let { codeField.setText(it) }
    }

    private fun start() {
        val server = serverField.text.toString().trim().trimEnd('/')
        val code = codeField.text.toString().trim().uppercase()
        when {
            MonitorState.running -> return show("Monitoring is already on.")
            !Regex("^https?://[^\\s/]+$").matches(server) -> return show("Enter the laptop address shown on the referee screen.")
            !Regex("^[A-Z0-9]{8}$").matches(code) -> return show("Enter the 8-character pairing code.")
            !consent.isChecked -> return show("Tick the agreement box to start. You can decline and play on an organizer device instead.")
        }
        startButton.isEnabled = false
        show("Pairing with the referee laptop...")
        thread {
            val device = JSONObject().put("model", "${Build.MANUFACTURER} ${Build.MODEL}".take(80)).put("os", "Android ${Build.VERSION.RELEASE}").put("agent", "android 1.0.0")
            val result = try { Api.postJson(server, "/device/claim", JSONObject().put("code", code).put("device", device)) } catch (_: Exception) { null }
            runOnUiThread {
                startButton.isEnabled = true
                when {
                    result == null -> show("Cannot reach $server. Check your internet connection and the address.")
                    !result.ok -> show(result.error("Pairing failed (${result.code})."))
                    else -> {
                        claim = result.json(); claimServer = server
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
        if (!Regex("^https?://[^\\s/]+$").matches(server) || !Regex("^[A-Z0-9]{8}$").matches(code)) return show("Enter the laptop address and pairing code first, so the referee knows who declined.")
        AlertDialog.Builder(this)
            .setTitle("Decline monitoring?")
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
    }
}
