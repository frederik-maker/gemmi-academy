package co.bussler.gemmi

import java.io.File
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Resumable HTTP download with SHA-256 verification. Writes to <target>.part
 * during the download and atomically renames on success so a half-finished
 * file is never picked up as "ready".
 *
 * Host requirements:
 *   - HTTPS endpoint serving the .litertlm file
 *   - Range request support (`bytes=N-`) for resume to work — Cloudflare R2
 *     and most S3-compatible stores support this; GitHub Releases doesn't.
 *
 * If the existing file already has the expected size and SHA, this returns
 * immediately without touching the network.
 */
object ModelDownloader {

  suspend fun ensure(
    url: String,
    target: File,
    expectedSize: Long,
    expectedSha256: String,
    onProgress: (downloaded: Long, total: Long) -> Unit,
  ) {
    // Already complete?
    if (target.exists() && target.length() == expectedSize) {
      if (sha256(target).equals(expectedSha256, ignoreCase = true)) return
      target.delete()
    }

    val partFile = File(target.parentFile, "${target.name}.part")
    val resumeFrom = if (partFile.exists()) partFile.length() else 0L

    val conn = (URL(url).openConnection() as HttpURLConnection).apply {
      requestMethod = "GET"
      if (resumeFrom > 0) {
        setRequestProperty("Range", "bytes=$resumeFrom-")
      }
      connectTimeout = 15_000
      readTimeout = 60_000
    }
    val responseCode = conn.responseCode
    if (responseCode !in 200..299) {
      conn.disconnect()
      throw RuntimeException("download_http_$responseCode")
    }
    val isResume = responseCode == 206
    val totalLen = if (isResume) {
      // Content-Range: bytes 1234-5678/9999
      val cr = conn.getHeaderField("Content-Range") ?: ""
      cr.substringAfter("/").toLongOrNull() ?: expectedSize
    } else {
      conn.contentLengthLong.takeIf { it > 0 } ?: expectedSize
    }

    val raf = RandomAccessFile(partFile, "rw")
    raf.seek(if (isResume) resumeFrom else 0L)

    try {
      conn.inputStream.use { input ->
        val buf = ByteArray(64 * 1024)
        var downloaded = if (isResume) resumeFrom else 0L
        var lastReported = 0L
        while (true) {
          val n = input.read(buf)
          if (n <= 0) break
          raf.write(buf, 0, n)
          downloaded += n
          // Throttle progress events to ~10/s so we don't spam the bridge.
          if (downloaded - lastReported > 256 * 1024) {
            lastReported = downloaded
            onProgress(downloaded, totalLen)
          }
        }
        onProgress(downloaded, totalLen)
      }
    } finally {
      raf.close()
      conn.disconnect()
    }

    // Verify before renaming so a corrupted file never replaces a good one.
    val actualSha = sha256(partFile)
    if (!actualSha.equals(expectedSha256, ignoreCase = true)) {
      partFile.delete()
      throw RuntimeException("sha256_mismatch_expected_${expectedSha256.take(8)}_got_${actualSha.take(8)}")
    }
    if (target.exists()) target.delete()
    if (!partFile.renameTo(target)) {
      throw RuntimeException("rename_failed")
    }
  }

  private fun sha256(file: File): String {
    val md = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buf = ByteArray(64 * 1024)
      while (true) {
        val n = input.read(buf)
        if (n <= 0) break
        md.update(buf, 0, n)
      }
    }
    return md.digest().joinToString("") { "%02x".format(it) }
  }
}
