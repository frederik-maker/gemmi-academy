package co.bussler.gemmi

import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Resumable HTTP downloader with sha256 verification. Used by:
 *   - PiperTtsPlugin (downloads .tar.bz2 voice archives from GitHub releases)
 *   - GemmiTutorPlugin (downloads .task LiteRT models, when wired)
 *
 * Why resumable: voice archives are 25–70 MB and model files can be hundreds
 * of MB. Mobile connections drop. GitHub releases (the actual host of every
 * artifact we fetch) sit behind a CDN that returns Accept-Ranges: bytes, so
 * a partial file can be resumed with a Range header on retry.
 *
 * Verification: every file we download has a published sha256. We re-hash
 * the assembled file before declaring success — if a corrupted resume left
 * us with a bad blob, the hash mismatch surfaces it cleanly.
 *
 * Callers run this on a coroutine; nothing here is suspendable but the
 * blocking reads/writes assume an IO dispatcher.
 */
object ModelDownloader {

  private const val TAG = "ModelDownloader"
  private const val BUF = 64 * 1024
  private const val MAX_RETRIES = 4

  fun ensure(
    url: String,
    target: File,
    expectedSize: Long,
    expectedSha256: String,
    onProgress: (downloaded: Long, total: Long) -> Unit,
  ) {
    // Already-downloaded path: hash matches → no work to do.
    if (target.exists() && target.length() == expectedSize) {
      val have = sha256(target)
      if (have.equals(expectedSha256, ignoreCase = true)) {
        onProgress(expectedSize, expectedSize)
        return
      }
      Log.w(TAG, "existing file has wrong sha; redownloading")
      target.delete()
    }

    target.parentFile?.mkdirs()
    var attempt = 0
    while (true) {
      attempt++
      try {
        download(url, target, expectedSize, onProgress)
        val got = sha256(target)
        if (!got.equals(expectedSha256, ignoreCase = true)) {
          target.delete()
          throw IllegalStateException("sha256_mismatch: expected $expectedSha256 got $got")
        }
        return
      } catch (e: Exception) {
        if (attempt >= MAX_RETRIES) throw e
        Log.w(TAG, "download attempt $attempt failed: ${e.message}; retrying")
        Thread.sleep(1000L * attempt)
      }
    }
  }

  private fun download(
    url: String,
    target: File,
    expectedSize: Long,
    onProgress: (Long, Long) -> Unit,
  ) {
    val existing = if (target.exists()) target.length() else 0L
    if (existing >= expectedSize) return  // already complete; will be hash-verified by caller

    val conn = (URL(url).openConnection() as HttpURLConnection).apply {
      requestMethod = "GET"
      connectTimeout = 15_000
      readTimeout = 30_000
      if (existing > 0) setRequestProperty("Range", "bytes=$existing-")
      instanceFollowRedirects = true
    }
    val code = conn.responseCode
    // 200 = full download, 206 = partial content (resume worked).
    if (code != HttpURLConnection.HTTP_OK && code != HttpURLConnection.HTTP_PARTIAL) {
      throw IllegalStateException("http_$code")
    }
    // If the server gave us 200 despite a Range header, start over from byte 0.
    val startAt = if (code == HttpURLConnection.HTTP_PARTIAL) existing else 0L
    if (startAt == 0L && target.exists()) target.delete()

    val total = expectedSize
    var written = startAt
    conn.inputStream.use { input ->
      RandomAccessFile(target, "rw").use { raf ->
        raf.seek(written)
        val buf = ByteArray(BUF)
        var lastReported = -1L
        while (true) {
          val n = input.read(buf)
          if (n <= 0) break
          raf.write(buf, 0, n)
          written += n
          // Throttle progress events to ~1% to avoid spamming the WebView.
          val pct = if (total > 0) (written * 100 / total) else 0
          if (pct != lastReported) {
            lastReported = pct
            onProgress(written, total)
          }
        }
      }
    }
    if (total > 0 && written < total) {
      throw IllegalStateException("short_read: $written/$total")
    }
  }

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileOutputStream(File(file.parentFile, ".sha256-probe")).use { /* touch to ensure dir is writable */ }
    File(file.parentFile, ".sha256-probe").delete()
    file.inputStream().use { input ->
      val buf = ByteArray(BUF)
      while (true) {
        val n = input.read(buf)
        if (n <= 0) break
        digest.update(buf, 0, n)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }
}
