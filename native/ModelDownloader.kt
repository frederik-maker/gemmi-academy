package co.bussler.gemmi

import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.coroutineScope
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.security.MessageDigest
import javax.net.ssl.SSLException

/**
 * Resumable HTTP download with SHA-256 verification. Writes to <target>.part
 * during the download and atomically renames on success so a half-finished
 * file is never picked up as "ready".
 *
 * Designed for the connection profile of the target users (rural Kazakhstan,
 * spotty cellular): inside this single ensure() call we retry on read /
 * connect / SSL faults with exponential backoff up to MAX_ATTEMPTS, and
 * resume from wherever the .part file got to using HTTP Range requests so
 * no progress is lost across drops. The caller still wraps the whole thing
 * with their own retry policy, but in practice this internal loop is enough
 * to ride out a few minutes of degraded connectivity.
 *
 * Host requirements:
 *   - HTTPS endpoint
 *   - Range request support (Accept-Ranges: bytes). Hugging Face's resolve
 *     URL serves via Cloudfront which supports this; S3, R2, GCS, and direct
 *     git-lfs hosts all work.
 *
 * If the existing target file already has the expected size and SHA-256,
 * this returns immediately without touching the network.
 */
object ModelDownloader {

  private const val MAX_ATTEMPTS = 8

  suspend fun ensure(
    url: String,
    target: File,
    expectedSize: Long,
    expectedSha256: String,
    onProgress: (downloaded: Long, total: Long) -> Unit,
  ) = coroutineScope {
    // Fast path: already fully downloaded and verified.
    if (target.exists() && target.length() == expectedSize) {
      if (sha256(target).equals(expectedSha256, ignoreCase = true)) return@coroutineScope
      target.delete()
    }

    val partFile = File(target.parentFile, "${target.name}.part")

    var attempt = 0
    var lastError: Throwable? = null
    while (isActive && attempt < MAX_ATTEMPTS) {
      attempt++
      try {
        downloadOnce(url, partFile, expectedSize, onProgress)
        // Got the full file. Verify before promoting.
        if (partFile.length() != expectedSize) {
          throw IOException("short_file_${partFile.length()}_of_$expectedSize")
        }
        val actualSha = sha256(partFile)
        if (!actualSha.equals(expectedSha256, ignoreCase = true)) {
          partFile.delete()
          throw IOException("sha256_mismatch_expected_${expectedSha256.take(8)}_got_${actualSha.take(8)}")
        }
        if (target.exists()) target.delete()
        if (!partFile.renameTo(target)) throw IOException("rename_failed")
        return@coroutineScope
      } catch (e: IOException) {
        // Treat I/O failures as transient — the .part file holds whatever we
        // got, the next attempt will resume from there.
        lastError = e
      } catch (e: SSLException) {
        lastError = e
      } catch (e: SocketTimeoutException) {
        lastError = e
      } catch (e: Exception) {
        // Non-retryable (e.g. 4xx response, sha mismatch on a complete
        // download): rethrow without retrying.
        throw e
      }
      if (attempt < MAX_ATTEMPTS) {
        // Backoff: 1s, 2s, 4s, 8s, 16s, 30s, 30s, 30s.
        val backoffMs = minOf(30_000L, 1000L shl minOf(attempt - 1, 5))
        delay(backoffMs)
      }
    }
    throw lastError ?: IOException("download_exhausted_after_${MAX_ATTEMPTS}_attempts")
  }

  /**
   * One HTTP GET that streams into partFile, starting from wherever the
   * existing .part file leaves off. Throws on any I/O failure; the caller
   * decides whether to retry.
   */
  private fun downloadOnce(
    url: String,
    partFile: File,
    expectedSize: Long,
    onProgress: (downloaded: Long, total: Long) -> Unit,
  ) {
    val resumeFrom = if (partFile.exists()) partFile.length() else 0L
    // Defensive: don't ask for a range past the end if .part somehow grew
    // beyond expected (corrupt previous run). Truncate first.
    if (resumeFrom > expectedSize) {
      partFile.delete()
    }
    val actualResumeFrom = if (partFile.exists()) partFile.length() else 0L

    val conn = (URL(url).openConnection() as HttpURLConnection).apply {
      requestMethod = "GET"
      instanceFollowRedirects = true
      // HF resolve URLs 302 to Cloudfront-signed URLs.
      if (actualResumeFrom > 0) {
        setRequestProperty("Range", "bytes=$actualResumeFrom-")
      }
      // User-Agent helps with some CDNs that reject default Java UA.
      setRequestProperty("User-Agent", "Gemmi-Android/1.0 (com.bussler.gemmi)")
      connectTimeout = 20_000
      readTimeout = 60_000
    }
    val responseCode = conn.responseCode
    if (responseCode !in 200..299) {
      conn.disconnect()
      // 416 (Range Not Satisfiable) means partFile is already at or past
      // end-of-content; treat it as a signal to drop and start over.
      if (responseCode == 416) {
        partFile.delete()
        throw IOException("range_not_satisfiable_resetting")
      }
      // 4xx is non-retryable — propagate without retry by throwing a non
      // IOException (the outer loop only retries IOException family).
      if (responseCode in 400..499) {
        throw RuntimeException("download_http_$responseCode")
      }
      throw IOException("download_http_$responseCode")
    }
    val isResume = responseCode == 206
    val totalLen = if (isResume) {
      val cr = conn.getHeaderField("Content-Range") ?: ""
      cr.substringAfter("/").toLongOrNull() ?: expectedSize
    } else {
      conn.contentLengthLong.takeIf { it > 0 } ?: expectedSize
    }

    val raf = RandomAccessFile(partFile, "rw")
    raf.seek(if (isResume) actualResumeFrom else 0L)
    if (!isResume) {
      // Server didn't honour our Range — restart from scratch.
      raf.setLength(0L)
    }

    try {
      conn.inputStream.use { input ->
        val buf = ByteArray(64 * 1024)
        var downloaded = if (isResume) actualResumeFrom else 0L
        var lastReported = 0L
        while (true) {
          val n = try {
            input.read(buf)
          } catch (e: IOException) {
            // Mid-stream drop. Let the outer loop resume from .part length.
            throw e
          }
          if (n <= 0) break
          raf.write(buf, 0, n)
          downloaded += n
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
