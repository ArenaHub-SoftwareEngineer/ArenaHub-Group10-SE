package ph.edu.wmsu.arenahub.companion

import org.json.JSONObject

/** Copy the current protocol stamp independently of cached device observations. */
internal fun JSONObject.withScanStamp(stamp: JSONObject?): JSONObject = apply {
    if (stamp != null) put("scan", JSONObject()
        .put("challenge", stamp.getString("challenge"))
        .put("policyVersion", stamp.getString("policyVersion")))
}
