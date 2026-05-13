package co.bussler.gemmi

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack

/**
 * Thin AudioTrack wrapper for streaming Piper TTS output as it synthesizes.
 *
 * Format: 32-bit float PCM mono. sherpa-onnx's OfflineTts returns FloatArray
 * samples in [-1, 1] from its generateWithCallback hook; AudioTrack accepts
 * ENCODING_PCM_FLOAT natively, so no conversion needed.
 *
 * Why STREAM mode (vs STATIC): audio starts playing the moment the first
 * chunk lands. Piper synthesis is fast enough on a Snapdragon 7-class chip
 * that perceived latency is ~250ms first-chunk for short tutor replies.
 */
class AudioStreamer(private val sampleRate: Int) {

  private val bufferSize = AudioTrack.getMinBufferSize(
    sampleRate,
    AudioFormat.CHANNEL_OUT_MONO,
    AudioFormat.ENCODING_PCM_FLOAT,
  ).coerceAtLeast(sampleRate * 4)  // ≥1s headroom

  private var track: AudioTrack? = null
  @Volatile private var stopped = false

  fun start() {
    val attrs = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ASSISTANT)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
    val format = AudioFormat.Builder()
      .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
      .setSampleRate(sampleRate)
      .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
      .build()
    val t = AudioTrack.Builder()
      .setAudioAttributes(attrs)
      .setAudioFormat(format)
      .setBufferSizeInBytes(bufferSize)
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
    t.play()
    track = t
    stopped = false
  }

  fun write(samples: FloatArray) {
    if (stopped) return
    track?.write(samples, 0, samples.size, AudioTrack.WRITE_BLOCKING)
  }

  /** Drain the buffer naturally and tear down — called when synth finishes. */
  fun endOfStream() {
    val t = track ?: return
    try {
      t.stop()
      t.release()
    } catch (_: Exception) {
      // AudioTrack throws if called in wrong state — fine to swallow at end.
    }
    track = null
  }

  /** Abort playback immediately. Safe to call from any thread. */
  fun stop() {
    stopped = true
    val t = track ?: return
    try {
      t.pause()
      t.flush()
      t.stop()
      t.release()
    } catch (_: Exception) { /* state may not allow it; fine */ }
    track = null
  }
}
