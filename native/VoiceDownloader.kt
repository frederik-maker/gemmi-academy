package co.bussler.gemmi

import android.util.Log
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

/**
 * Extracts a Piper voice .tar.bz2 archive (from the k2-fsa/sherpa-onnx
 * tts-models GitHub release) into the target directory.
 *
 * Each voice tarball contains a single top-level directory like
 * `vits-piper-kk_KZ-iseke-x_low/`, holding:
 *   <voice>.onnx        VITS model — renamed to model.onnx
 *   <voice>.onnx.json   Piper config — left as-is (sherpa-onnx may glance
 *                       at it sitting alongside the model)
 *   tokens.txt          phoneme vocabulary
 *   lexicon.txt         (some voices) pronunciation overrides
 *   espeak-ng-data/     (most voices) phonemiser data with ~150 small files
 *   MODEL_CARD          metadata; ignored
 *
 * Extraction is atomic: we unpack into a sibling `.tmp` dir, validate
 * the required files landed and are non-empty, then rename the tmp dir
 * into place. A crash mid-way leaves the previous state intact instead
 * of a half-populated voiceDir that would silently crash sherpa-onnx the
 * next time the user tried to speak.
 */
object VoiceDownloader {

  private const val TAG = "VoiceDownloader"

  @Throws(Exception::class)
  fun extract(archive: File, voiceDir: File) {
    val tmpDir = File(voiceDir.parentFile, voiceDir.name + ".tmp")
    // Clean any leftover tmp from a prior failed attempt.
    if (tmpDir.exists()) tmpDir.deleteRecursively()
    tmpDir.mkdirs()

    BZip2CompressorInputStream(BufferedInputStream(FileInputStream(archive))).use { bzipIn ->
      TarArchiveInputStream(bzipIn).use { tarIn ->
        while (true) {
          val entry = tarIn.nextTarEntry ?: break
          if (entry.isDirectory) continue
          // Strip the leading "vits-piper-XX-name/" segment.
          val name = entry.name.substringAfter('/', missingDelimiterValue = entry.name)
          if (name.isBlank()) continue
          val target = File(tmpDir, name)
          target.parentFile?.mkdirs()
          FileOutputStream(target).use { out ->
            tarIn.copyTo(out, bufferSize = 64 * 1024)
          }
        }
      }
    }

    // Rename <voice>.onnx → model.onnx so PiperEngine.load() doesn't need
    // the voice id. The .onnx.json config file stays next to it under its
    // original name; sherpa-onnx reads it implicitly when present.
    if (!File(tmpDir, "model.onnx").exists()) {
      val onnx = tmpDir.listFiles()?.firstOrNull { it.extension == "onnx" }
      if (onnx == null) {
        throw IllegalStateException("voice_extract: no .onnx file found in archive")
      }
      if (!onnx.renameTo(File(tmpDir, "model.onnx"))) {
        throw IllegalStateException("voice_extract: rename ${onnx.name} → model.onnx failed")
      }
    }

    // Validate required files are present and non-empty BEFORE swapping
    // into place. sherpa-onnx will SIGSEGV (not throw) if model.onnx is
    // truncated, so we'd rather fail loudly here with a JS-visible error.
    val model = File(tmpDir, "model.onnx")
    val tokens = File(tmpDir, "tokens.txt")
    if (!model.exists() || model.length() < 1024) {
      throw IllegalStateException("voice_extract: model.onnx missing or too small (${model.length()} bytes)")
    }
    if (!tokens.exists() || tokens.length() == 0L) {
      throw IllegalStateException("voice_extract: tokens.txt missing or empty")
    }

    // Atomic swap: nuke the old voiceDir (if any) and rename tmp → real.
    if (voiceDir.exists()) voiceDir.deleteRecursively()
    if (!tmpDir.renameTo(voiceDir)) {
      throw IllegalStateException("voice_extract: tmp → voiceDir rename failed")
    }
    Log.i(TAG, "extracted ${voiceDir.name}: model=${model.length()}b tokens=${tokens.length()}b")
  }
}
