plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ph.edu.wmsu.arenahub.companion"
    compileSdk = 35

    defaultConfig {
        applicationId = "ph.edu.wmsu.arenahub.companion"
        // Android 10+: needed for the screen-recording service type and app-op checks used here.
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
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

// No third-party libraries: the platform SDK, org.json and HttpURLConnection cover everything.
dependencies {}
