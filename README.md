# UniMeet — Find your people. Make plans. Go together.

UniMeet helps university students find something to do and someone to do it with. Browse concerts, cinema nights, festivals and campus meetups, see which students share your interests, and join a small group instead of going alone.

Built for **UniHack 2026** in Timișoara, Romania.

| | |
|---|---|
| **Live website** | https://bidbex.github.io/UniMeet/ |
| **Android app (APK)** | [Download the latest release](https://github.com/BidBex/UniMeet/releases/latest/download/UniMeet-release.apk) · [All releases](https://github.com/BidBex/UniMeet/releases) |
| **Demo account** | `demo@unimeet.app` / `DemoUser123!` (or tap **Sign in as Demo Student** on the login page) |

---

## The problem

Students miss events they would enjoy because nobody in their circle is free or shares the same interest. Asking strangers to come along is awkward, and existing social apps are built around browsing profiles, not around a specific plan.

## Our solution

UniMeet connects people around **concrete plans**. You start from an event, see who else wants to go, and make plans in a chat. If you have no one to go with, you post that you're **Going Solo** and join others in the same situation.

## Features

- **Events:** browse upcoming outings, search and filter them by category and date, like or join them, and create your own with a cover photo.
- **Discover:** swipe through events, people, groups and Going Solo posts (or use the arrow keys on desktop).
- **Compatibility score:** every person gets a 0–100 score with a plain-language reason, for example "Matched on 3 shared interests · same university".
- **Mutual matches:** when two students like each other for the same event, a match and a private chat are created.
- **Groups:** join public groups or create one (2–100 members, 8 by default) with its own group chat.
- **Going Solo:** announce that you're going to an event alone (the post stays up for 48 hours by default) and find others doing the same.
- **Real-time chat:** messages update live. You can unsend your own messages or delete any message for yourself.
- **Profiles:** interests, hobbies, university and city (both optional), bio, and a choice of 18 illustrated avatars.
- **Safety tools:** block users (they disappear from your Discover, matches and Going Solo lists), report them with a reason such as harassment, a fake profile or a meetup safety concern, and manage your blocked list in your profile.
- **Settings:** light and dark theme, and a choice of accent color.
- **Android app:** the same app packaged for Android. It tells you when a newer version is available.

## How the compatibility score works

The score is computed in the app (`computeCompatibility` in `frontend/js/api.js`) from four parts:

| Part | Points |
|---|---|
| Shared interests (overlap of both students' interests) | up to 60 |
| Same university | 20 |
| Same city | 10 |
| Similar taste in event categories | up to 10 |

The app always shows the reasons behind the score, so students know why someone was suggested.

## Try it (for judges)

1. Open https://bidbex.github.io/UniMeet/ and tap **Log In → Sign in as Demo Student**.
2. **Discover:** swipe through events and people, then open a person's card to see their compatibility score and reasons.
3. **Events:** open an event, like it or join it.
4. **Groups → Going Solo Feed:** see students going alone and join a group.
5. **Messages:** open a conversation, send a message, and try the three-dot menu on a message.
6. **Profile:** pick an avatar and save. Then open **Settings** and switch to dark mode.

The demo account runs on built-in sample data that is saved in your browser, so you can try everything without affecting real users. **Settings → Reset Demo Account to Defaults** restores the profile. To try the real backend, create your own account on the **Create Account** page.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS and plain JavaScript modules (`frontend/`), no framework |
| Build | [Vite](https://vite.dev) |
| Authentication | Firebase Authentication (email/password, email verification, password reset) |
| Database | Cloud Firestore with real-time listeners, security rules (`firestore.rules`) and indexes (`firestore.indexes.json`) |
| Android | [Capacitor](https://capacitorjs.com), built and signed by GitHub Actions |
| Hosting | GitHub Pages |
| CI | GitHub Actions: website deploy, Android release build, automatic layout check |

## Architecture

```
Browser / Android app (Capacitor WebView)
        │  HTML + CSS + JS modules, built by Vite
        │
        ├── Firebase Authentication   sign-up, login, sessions
        └── Cloud Firestore           users, events, groups, matches, chats (live updates)
```

There is no separate application server. The app talks to Firebase directly, and `firestore.rules` controls what each signed-in user may read and write.

## Project structure

```
frontend/              Web app (one HTML page per screen)
  js/api.js            All Firebase calls and the compatibility score
  js/demo-store.js     Sample data for the demo account
  js/navigation.js     Shared navigation, menus and safety modals
  css/                 Design system and responsive layout
  assets/images/       Event photos and avatars
firestore.rules        Firestore security rules
storage.rules          Firebase Storage rules (photo uploads)
functions/             Cloud Functions (written, not deployed; see Known limitations)
scripts/               Layout check and an optional SQLite → Firestore migration
backend/               Earlier FastAPI + SQLite prototype, kept for reference
.github/workflows/     Website deploy, Android APK, layout check, Firebase deploy
```

## Run it locally

Requirements: Node.js 22.

```bash
npm install --ignore-scripts --legacy-peer-deps
npm run dev        # development server on http://localhost:3000
npm run build      # production build in dist/
npm run lint       # TypeScript check + Firestore rules lint
```

The Firebase project settings are in `firebase-applet-config.json`. These values identify the project and are safe to publish; access is controlled by `firestore.rules`.

## Deployment and CI

- **Website:** every push to `main` builds the site and publishes it to GitHub Pages (`.github/workflows/github-pages.yml`).
- **Android app:** pushing a version tag such as `v1.2.0` builds a signed APK and publishes it as a GitHub release (`.github/workflows/android-apk.yml`). Each build gets a higher version number and the same signing key, so updates install over the previous version. Details are in [ANDROID_APK.md](ANDROID_APK.md).
- **Layout check:** every pull request opens all 13 pages at 320, 360, 768 and 1440px. It fails if a page scrolls sideways, an image is broken, a file is missing or a JavaScript error occurs (`scripts/check-layout.mjs`).

## Security and privacy

- Firestore security rules limit each user to their own profile and private data, and restrict which fields can be changed.
- Blocked users are hidden from your lists, and reports are saved to Firestore for moderation.
- University affiliation is optional. UniMeet does not verify identities, so the app encourages meeting in public places.
- The Android APK is a non-debuggable release build, signed with a permanent key, with backups and unencrypted HTTP turned off.

## Known limitations

- **Photo uploads** need Firebase Storage, which requires Firebase's paid Blaze plan. Our project is on the free tier, so users choose a built-in avatar or paste an image link instead.
- **Cloud Functions** in `functions/` (match notifications, moderation) are written but not deployed, for the same reason. Matching and scoring run in the app.
- **Feed posts** (posting, reactions, comments) currently work only with the demo account.
- The free Firestore tier allows about 50,000 reads per day.

## What's next

- Upgrade the Firebase project to enable photo uploads and push notifications for new messages.
- Deploy the Cloud Functions so match creation and moderation run on the server.
- Bring Feed posting to all accounts.
- Publish the app on Google Play.

## Team

- **Opre Matei** — [github.com/BidBex](https://github.com/BidBex)
- **Mureșan Tiago** - [github.com/Tiago3241](https://github.com/Tiago3241)
- **Oprișor Radu** - [github.com/Andrei2025](https://github.com/Andrei2025)

## Credits

- Event photos: [Unsplash](https://unsplash.com), used under the Unsplash License. Sources are listed in [`frontend/assets/images/CREDITS.md`](frontend/assets/images/CREDITS.md).
- Built with Firebase, Vite and Capacitor.
