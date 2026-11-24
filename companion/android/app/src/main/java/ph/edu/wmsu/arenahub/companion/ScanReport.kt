package ph.edu.wmsu.arenahub.companion

import org.json.JSONArray
import org.json.JSONObject

/** Copy the current protocol stamp independently of cached device observations. */
internal fun JSONObject.withScanStamp(stamp: JSONObject?): JSONObject = apply {
    if (stamp != null) put("scan", JSONObject()
        .put("challenge", stamp.getString("challenge"))
        .put("policyVersion", stamp.getString("policyVersion")))
}

enum class Tone { OK, BAD, WARN, INFO }

/** The server's scan verdict (official) or the practice result, shaped for the screen. */
data class ScanView(val status: String, val label: String, val detail: String, val blockers: List<String>, val warnings: List<String>) {
    val tone: Tone get() = when (status) {
        "ready" -> Tone.OK
        "blocked", "declined" -> Tone.BAD
        "scanning", "incomplete", "stale", "required" -> Tone.WARN
        else -> Tone.INFO
    }
    companion object {
        fun from(json: JSONObject?): ScanView? {
            if (json == null || !json.has("status")) return null
            return ScanView(json.optString("status"), json.optString("label"), json.optString("detail"), json.optJSONArray("blockers").texts(), json.optJSONArray("warnings").texts())
        }
        private fun JSONArray?.texts(): List<String> = if (this == null) emptyList() else (0 until length()).map { optString(it) }.filter { it.isNotBlank() }
    }
}

/** One finding as the player reads it: what it is, then why (and where, for files). */
data class FindingLine(val title: String, val detail: String?)

private val HASH = Regex(" SHA-256 [0-9a-f]{64}")
private val PLACED = Regex("^([A-Za-z][A-Za-z ]{1,20}): (.+?) - (.+)$")

/** "Downloads: x.apk - Renamed copy of ... SHA-256 <hash>" becomes "x.apk" / "Renamed copy of ... · Downloads". */
fun findingLine(text: String): FindingLine {
    // Fingerprints help staff, not players.
    val clean = text.replace(HASH, "").trim()
    val placed = PLACED.find(clean) ?: return FindingLine(clean, null)
    val (where, name, reason) = placed.destructured
    return FindingLine(name, "$reason · $where")
}
