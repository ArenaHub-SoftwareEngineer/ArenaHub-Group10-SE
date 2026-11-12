package ph.edu.wmsu.arenahub.companion

import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Minimal client for the laptop's /api/integrity routes. Call only from background threads. */
object Api {
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

    fun postJson(server: String, path: String, body: JSONObject, token: String? = null): Result {
        val connection = open("$server/api/integrity$path", token, "application/json")
        connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        return read(connection)
    }

    fun postFile(server: String, path: String, file: File, contentType: String, token: String): Result {
        val connection = open("$server/api/integrity$path", token, contentType)
        connection.setFixedLengthStreamingMode(file.length())
        connection.outputStream.use { out -> file.inputStream().use { it.copyTo(out) } }
        return read(connection)
    }
}
