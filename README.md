# FinanceTrackerUI

## Frontend deployment

See [Cloudflare Pages deployment guide](./CLOUDFLARE_DEPLOYMENT.md) for setup,
deployment, and how to verify whether the frontend is live.

## Android app

The web app can be packaged as an Android app with Capacitor. The `WebApp/android/` project is included. From `WebApp/`, install dependencies:

```sh
npm ci
```

Run `npm run android:add` only if you need to regenerate the native project.

Use Node.js 22 or newer, Android Studio with Android SDK 36, and a Java 21 JDK. To build a debug APK, point the web build at a backend reachable from the device (do not use `localhost`, which would refer to the device itself):

```sh
VITE_API_BASE_URL=https://financetracker-iulg.onrender.com npm run android:apk
```

The APK is written to `WebApp/android/app/build/outputs/apk/debug/app-debug.apk`. The backend must allow requests from the Capacitor app origin and have its OAuth redirect/callback configuration set up for the Android app. Re-run `npm run android:apk` after web changes to rebuild and sync the web assets into Android.