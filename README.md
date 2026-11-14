# UniMeet — Find your people. Make plans. Go together.

Built for **UniHack2026** (Timisoara, Romania) and powered by **Firebase**.

## What UniMeet Is & The Problem It Solves

University students regularly miss concerts, outdoor cinema nights, festivals, theatre performances, and campus meetups simply because nobody in their immediate circle is free or shares the same niche interest. **UniMeet** solves this by connecting people around **concrete shared plans** rather than endless profile browsing.

## How It Works

1. **Create a profile & pick interests**: Students register via Firebase Authentication (email/password), verify their email, upload a profile photo to Firebase Storage, and select interests and hobbies.
2. **Discover events, people, groups, or Going Solo posts**: Swipe or filter through upcoming outings, see explainable compatibility scores (`0–100`), join public or private groups, or announce **"Going Solo"** for an upcoming event.
3. **Match & chat in real time**: Reciprocal event likes create mutual matches and open dedicated conversations synced live via Cloud Firestore `onSnapshot` listeners.

## Technology Stack

- **Frontend & Build**: Semantic HTML5, CSS3 design system, Vanilla ES modules (`frontend/`), bundled with Vite (`vite.config.ts`) and Capacitor Android (`capacitor.config.json`).
- **Cloud Backend**:
  - **Firebase Authentication**: Email/password sign-up, login, password reset (`reset-password.html`), email verification, and persistent sessions (`browserLocalPersistence`).
  - **Cloud Firestore** (`ai-studio-unimeet-dcbd9c9e-96ae-49f0-bc6e-add8a5546578`): Primary cloud database with real-time listeners, hardened `firestore.rules`, and composite `firestore.indexes.json`.
  - **Firebase Storage**: Profile photo and event cover uploads (`storage.rules`).
  - **Cloud Functions (`functions/`)**: Node 22 v2 triggers (`onUserLikeCreated`, `onChatMessageCreated`, `computeMatchCompatibility`, `moderateReport`).

## Demo Account

You can explore UniMeet right away using the built-in demo student account on `login.html` (or click **Sign in as Demo Student**):

- **Email**: `demo@unimeet.app`
- **Password**: `DemoUser123!`

On first sign-in (with **Email/Password** enabled in Firebase Authentication), if `demo@unimeet.app` does not yet exist in Firebase Authentication, UniMeet automatically creates the account, populates the demo profile (`Alex Popescu`, Politehnica University of Timisoara), and loads starter sample outings if none exist yet. You can restore the demo profile's default interests and hobbies anytime in **Settings**.

## Local Development

```bash
npm install --ignore-scripts --legacy-peer-deps
npm run dev        # Runs Vite dev server on http://0.0.0.0:3000
npm run build      # Builds production bundle into dist/
npm run lint       # Runs TypeScript check + ESLint on firestore.rules
```

## Firebase Deployment (Browser-Only via GitHub Actions or Firebase Console)

No local terminal or Firebase CLI installation is required:

- **GitHub Actions (`Deploy Firebase Backend`)**: Run `.github/workflows/firebase-deploy.yml` directly from the GitHub **Actions** tab after adding your Firebase Service Account JSON (`Firebase Console -> Project Settings -> Service accounts -> Generate new private key`) as a GitHub Actions secret named `FIREBASE_SERVICE_ACCOUNT`.
- **Firebase Console UI**: Rules in `firestore.rules` and `storage.rules` can also be pasted and published directly in the browser under **Firestore Database -> Rules** and **Storage -> Rules**.
- **Optional CLI equivalent** (if deploying from a workstation): `firebase deploy --only firestore:rules,firestore:indexes,storage,functions,hosting`.

## Optional SQLite Migration (`backend/unimeet.db`)

Legacy FastAPI + SQLite files remain archived in `backend/`. To migrate existing SQLite rows into Firebase Auth & Cloud Firestore:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
python3 scripts/migrate_sqlite_to_firestore.py --dry-run
python3 scripts/migrate_sqlite_to_firestore.py
```

## Android APK

See [ANDROID_APK.md](ANDROID_APK.md) and `.github/workflows/android-apk.yml` for automated Capacitor Android APK generation.
