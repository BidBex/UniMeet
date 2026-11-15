# Build and publish the Android APK

This app is bundled with Vite + the Firebase Web SDK and wrapped in Capacitor for Android. There is no separate FastAPI backend or `API_BASE_URL` required — mobile builds connect directly to Firebase Authentication, Cloud Firestore, and Firebase Storage over HTTPS.

## Why Release Signing Matters
Previously, debug APKs (`app-debug.apk`) were marked `android:debuggable="true"` and signed with the generic `Android Debug` certificate, which causes browsers, antivirus scanners, and Google Play Protect to block downloads as potentially harmful.

`.github/workflows/android-apk.yml` now builds a **hardened, non-debuggable, v1/v2/v3 signed Release APK** (`UniMeet-release.apk`) with `usesCleartextTraffic="false"` and `allowBackup="false"`, and also produces `UniMeet-release-apk.zip` + a `SHA-256` checksum.

## Build (Browser-Only via GitHub)
1. Ensure Firebase Authentication (**Email/Password** provider) and Firebase Storage are enabled in your Firebase Console (`ardent-lens-35wls`).
2. Push changes to `main` or open **Actions -> Android APK -> Run workflow** in GitHub.
3. Download the `unimeet-android-apk` workflow artifact (or download `UniMeet-release.apk` / `UniMeet-release-apk.zip` from Releases if tagged `v*`).

## Optional: Consistent Release Signing Key (Recommended for In-Place Updates)
Without extra setup, the workflow generates a clean non-debug RSA release key per run so the APK installs and passes verification. If you want future APK updates to install over older versions without uninstalling first, add these GitHub repository secrets (**Settings -> Secrets and variables -> Actions**):
- `ANDROID_KEYSTORE_BASE64` — base64-encoded `.jks` / `.keystore` file
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

## In-App Update Notice
Release builds (tags like `v1.2.0`) embed their version via `VITE_APP_VERSION`. Inside the app, `frontend/js/update-check.js` compares it with the latest GitHub release (at most every 6 hours) and shows a **New version available** banner with an **Update** link to the new APK. **Later** hides it until the next release. The website and non-release builds never show it.

## Installing on Android
- **If downloaded from GitHub Actions Artifacts**, extract the downloaded zip file first on your phone (Files app) to access `UniMeet-release.apk`.
- **If Play Protect prompts "Unrecognized app / developer"**: Every APK distributed outside Google Play Store is unknown to Play Protect until uploaded to Google Play; tap **More details -> Install anyway** (or **Scan app**).
- **For zero-warning distribution**, publish the app bundle (`.aab`) via Google Play Console or use the live HTTPS web app (**Add to Home Screen** on Android Chrome / iOS Safari).
