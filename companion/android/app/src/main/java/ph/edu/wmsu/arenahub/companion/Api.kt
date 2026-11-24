package ph.edu.wmsu.arenahub.companion

import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Minimal client for the laptop's /api/integrity routes. Call only from background threads. */
object Api {
    fun validServer(value: String): Boolean = try {
        val url = URL(value)
        val local = url.host == "localhost" || url.host == "127.0.0.1" || url.host == "[::1]" ||
            Regex("^(10\\.([0-9]{1,3}\\.){2}[0-9]{1,3}|192\\.168\\.[0-9]{1,3}\\.[0-9]{1,3}|172\\.(1[6-9]|2[0-9]|3[01])\\.[0-9]{1,3}\\.[0-9]{1,3})$").matches(url.host)
        (url.protocol == "https" || (BuildConfig.ALLOW_LAN_HTTP && url.protocol == "http" && local)) && url.host.isNotBlank() && url.userInfo == null && url.query == null && url.ref == null &&
            (url.path.isNullOrEmpty() || url.path == "/") && value.none { it.isWhitespace() || it == '\\' || it == '"' || it == '\'' || it == '<' || it == '>' }
    } catch (_: Exception) { false }
    class Result(val code: Int, val body: String) {
        val ok get() = code in 200..299
        fun json(): JSONObject = try { JSONObject(body) } catch (_: Exception) { JSONObject() }
        fun error(fallback: String): String = json().optString("error").ifBlank { fallback }
    }

    private fun open(url: String, token: String?, contentType: String): HttpURLConnection {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.connectTimeout = 8_000
        connection.readTimeout = 30_000
        connection.doOutput = true
        // A redirect must never forward a player's monitoring credentials to another origin.
        connection.instanceFollowRedirects = false
        connection.setRequestProperty("Content-Type", contentType)
        if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
        return connection
    }

    private fun read(connection: HttpURLConnection): Result {
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
        connection.disconnect()
        return Result(code, body)
    }

    fun getJson(server: String, path: String): Result {
        val connection = URL("$server/api/integrity$path").openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.connectTimeout = 8_000
        connection.readTimeout = 15_000
        connection.instanceFollowRedirects = false
        return read(connection)
    }

    fun postJson(server: String, path: String, body: JSONObject, token: String? = null): Result {
        val connection = open("$server/api/integrity$path", token, "application/json")
        connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        return read(connection)
    }

    /** Live screen sharing: "info" names the player and match, "token" returns the LiveKit address and access token. */
    fun pov(server: String, action: String, key: String): Result {
        val connection = open("$server/api/integrity/device/pov/$action", key, "application/json")
        connection.readTimeout = 8000
        val bytes = "{}".toByteArray()
        connection.setFixedLengthStreamingMode(bytes.size)
        connection.outputStream.use { it.write(bytes) }
        return read(connection)
    }

    fun postFile(server: String, path: String, file: File, contentType: String, token: String): Result {
        val connection = open("$server/api/integrity$path", token, contentType)
        connection.setFixedLengthStreamingMode(file.length())
        connection.outputStream.use { out -> file.inputStream().use { it.copyTo(out) } }
        return read(connection)
    }
}
