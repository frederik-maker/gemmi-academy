package co.bussler.gemmi

import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

/**
 * Extracts a Piper voice .tar.bz2 archive (from the k2-fsa/sherpa-onnx
 * tts-models GitHub release) into a flat target directory.
 *
 * Each voice tarball contains a single top-level directory like
 * `vits-piper-kk_KZ-iseke-x_low/`, holding:
 *   model.onnx          VITS model
 *   tokens.txt          phoneme vocabulary
 *   lexicon.txt         (some voices) pronunciation overrides
 *   espeak-ng-data       (some voices) shared espeak-ng phonemiser data
 *   MODEL_CARD          metadata; ignored
 *
 * We flatten the leading directory so PiperEngine.load() can reference
 * `model.onnx` and `tokens.txt` by fixed name regardless of voice id.
 */
object VoiceDownloader {

  fun extract(archive: File, voiceDir: File) {
    voiceDir.mkdirs()
    BZip2CompressorInputStream(BufferedInputStream(FileInputStream(archive))).use { bzipIn ->
      TarArchiveInputStream(bzipIn).use { tarIn ->
        while (true) {
          val entry = tarIn.nextTarEntry ?: break
          if (entry.isDirectory) continue
          // Strip the leading "vits-piper-XX-name/" segment.
          val name = entry.name.substringAfter('/', missingDelimiterValue = entry.name)
          if (name.isBlank()) continue
          val target = File(voiceDir, name)
          target.parentFile?.mkdirs()
          FileOutputStream(target).use { out ->
            tarIn.copyTo(out, bufferSize = 64 * 1024)
          }
        }
      }
    }
    // Most voices ship the .onnx with the voice id baked in
    // (e.g. en_US-lessac-medium.onnx); rename to a stable model.onnx so
    // PiperEngine.load() doesn't need the voice id.
    if (!File(voiceDir, "model.onnx").exists()) {
      val onnx = voiceDir.listFiles()?.firstOrNull { it.extension == "onnx" }
      onnx?.renameTo(File(voiceDir, "model.onnx"))
    }
  }
}
