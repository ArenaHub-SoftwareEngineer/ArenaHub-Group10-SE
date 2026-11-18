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
        versionCode = 5
        versionName = "3.2.0"
        // Public builds require TLS. A separate, explicit LAN-test build may permit local HTTP.
        val allowLan = providers.gradleProperty("allowLanHttp").orNull == "true"
        manifestPlaceholders["allowLanHttp"] = allowLan.toString()
        buildConfigField("boolean", "ALLOW_LAN_HTTP", allowLan.toString())
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
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
