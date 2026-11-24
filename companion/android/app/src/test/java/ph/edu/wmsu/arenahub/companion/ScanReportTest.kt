package ph.edu.wmsu.arenahub.companion

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ScanReportTest {
    @Test fun currentStampSurvivesTheActualJsonWireFormatAndCachedObservations() {
        val cachedGames = org.json.JSONArray().put(JSONObject().put("packageName", "com.mobile.legends"))
        val stamp = JSONObject().put("challenge", "a".repeat(48)).put("policyVersion", "b".repeat(64))
        val first = JSONObject().put("games", cachedGames).withScanStamp(stamp)
        stamp.put("policyVersion", "c".repeat(64))
        val second = JSONObject().put("games", cachedGames).withScanStamp(stamp)
        assertEquals("b".repeat(64), JSONObject(first.toString()).getJSONObject("scan").getString("policyVersion"))
        assertEquals("c".repeat(64), JSONObject(second.toString()).getJSONObject("scan").getString("policyVersion"))
        assertEquals("a".repeat(48), second.getJSONObject("scan").getString("challenge"))
        assertEquals("com.mobile.legends", second.getJSONArray("games").getJSONObject(0).getString("packageName"))
    }

    @Test fun absentStampDoesNotManufactureReadiness() {
        assertFalse(JSONObject().withScanStamp(null).has("scan"))
    }

    @Test fun verdictReadsTheServerShapeAndPicksATone() {
        val json = JSONObject().put("status", "blocked").put("label", "Action required").put("detail", "Close it")
            .put("blockers", org.json.JSONArray().put("Restricted app: Lulubox").put("")).put("warnings", org.json.JSONArray())
        val view = ScanView.from(json)!!
        assertEquals(Tone.BAD, view.tone)
        assertEquals(listOf("Restricted app: Lulubox"), view.blockers)
        assertEquals(Tone.OK, ScanView.from(JSONObject().put("status", "ready"))!!.tone)
        assertEquals(Tone.WARN, ScanView.from(JSONObject().put("status", "incomplete"))!!.tone)
        assertNull("no verdict before the first report", ScanView.from(null))
        assertNull(ScanView.from(JSONObject()))
    }

    @Test fun findingsPutTheNameFirstAndDropFingerprints() {
        val line = findingLine("Downloads: tool.apk - Renamed copy of a listed tool SHA-256 ${"a".repeat(64)}")
        assertEquals("tool.apk", line.title)
        assertEquals("Renamed copy of a listed tool · Downloads", line.detail)
        assertEquals(FindingLine("Root access detected", null), findingLine("Root access detected"))
    }
}
