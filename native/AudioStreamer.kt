package co.bussler.gemmi

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack

/**
 * Thin AudioTrack wrapper for streaming Piper TTS samples.
 *
 * Format: 16-bit PCM, mono. sherpa-onnx returns FloatArray samples in
 * [-1, 1], which we convert to shorts before handing to AudioTrack.
 *
 * Why 16-bit and not the float-PCM that sherpa-onnx natively emits:
 *   • ENCODING_PCM_FLOAT is API 21+ but isn't supported on every codec
 *     the user might end up on (kk voice is 16 kHz, lower-end phones
 *     reject float at that rate). 16-bit at 16 kHz is universal.
 *   • An earlier APK crashed on Kazakh TTS — the only difference from
 *     en/ru (which worked) was the kk voice's 16 kHz sample rate, and
 *     the most likely native cause was AudioTrack.write rejecting the
 *     float buffer at that rate. Switching to 16-bit removes the
 *     variable.
 *
 * STREAM mode (vs STATIC) means audio starts playing the moment the
 * first chunk lands. Piper synthesis on a Snapdragon-7 hits first chunk
 * in <300ms for short tutor replies.
 */
class AudioStreamer(private val sampleRate: Int) {

  private val bufferSize = AudioTrack.getMinBufferSize(
    sampleRate,
    AudioFormat.CHANNEL_OUT_MONO,
    AudioFormat.ENCODING_PCM_16BIT,
  ).coerceAtLeast(sampleRate * 2)  // ≥1s headroom (16-bit mono = 2 bytes/sample)

  private var track: AudioTrack? = null
  @Volatile private var stopped = false

  fun start() {
    val attrs = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ASSISTANT)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
    val format = AudioFormat.Builder()
      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
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
    val t = track ?: return
    // Float [-1, 1] → 16-bit signed. Clamp first to avoid wrap-around
    // for the rare sample that overshoots due to noise scale settings.
    val shorts = ShortArray(samples.size)
    for (i in samples.indices) {
      val f = samples[i].coerceIn(-1f, 1f)
      shorts[i] = (f * 32767f).toInt().toShort()
    }
    try {
      t.write(shorts, 0, shorts.size, AudioTrack.WRITE_BLOCKING)
    } catch (_: Exception) {
      // AudioTrack throws if you write after it's been released; the
      // stop() path can win the race. Swallowing is correct here.
    }
  }

  /** Drain the buffer naturally and tear down — called when synth finishes. */
  fun endOfStream() {
    val t = track ?: return
    try {
      t.stop()
      t.release()
    } catch (_: Exception) { /* state may not allow it at end; ok */ }
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
