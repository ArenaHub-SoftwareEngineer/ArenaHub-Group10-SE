plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ph.edu.wmsu.arenahub.companion"
    compileSdk = 35
    buildFeatures { buildConfig = true }

    defaultConfig {
        applicationId = "ph.edu.wmsu.arenahub.companion"
        // Android 10+: needed for the screen-recording service type and app-op checks used here.
        minSdk = 29
        targetSdk = 35
        versionCode = 8
        versionName = "3.5.0"
        // Public builds require TLS. A separate, explicit LAN-test build may permit local HTTP.
        val allowLan = providers.gradleProperty("allowLanHttp").orNull == "true"
        manifestPlaceholders["allowLanHttp"] = allowLan.toString()
        buildConfigField("boolean", "ALLOW_LAN_HTTP", allowLan.toString())
        // WebRTC ships native code per CPU type. Phones are ARM; x86_64 is kept for the Android emulator.
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64") }
    }

    buildTypes {
        debug {
            isDebuggable = false
        }
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

// Runtime uses the platform SDK. JVM tests use a real JSON implementation instead of SDK stubs.
dependencies {
    // Live screen sharing to match staff over WebRTC (https://github.com/livekit/client-sdk-android).
    implementation("io.livekit:livekit-android:2.30.0")
    // LiveKit uses coroutines internally but does not expose them; the sharing code calls its suspend functions.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
