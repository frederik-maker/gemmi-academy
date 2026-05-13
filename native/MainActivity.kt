package co.bussler.gemmi

import com.getcapacitor.BridgeActivity

/**
 * Replaces the Java MainActivity that `cap add android` generates. We need
 * a Kotlin MainActivity because every native plugin we register here is
 * written in Kotlin and Java's class lookup at registerPlugin time prefers
 * matching language for the lambda-style additions Capacitor 8 uses.
 *
 * The Java version (auto-generated empty subclass of BridgeActivity) is
 * deleted by scripts/wire-native.sh before this file is dropped in.
 */
class MainActivity : BridgeActivity() {
  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    registerPlugin(HelloPlugin::class.java)
    super.onCreate(savedInstanceState)
  }
}
