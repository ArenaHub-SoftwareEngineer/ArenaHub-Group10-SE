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
}
