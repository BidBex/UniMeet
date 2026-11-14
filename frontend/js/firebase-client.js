/**
 * Firebase Web SDK initialization & unified error handling for UniMeet2026.
 * Loads config from Vite env vars (VITE_FIREBASE_*) with fallback to firebase-applet-config.json.
 * Uses explicit Firestore named database ID and browserLocalPersistence for cross-reload/mobile auth.
 */
import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
} from "firebase/auth";
import { doc, getDocFromServer, getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import appletFirebaseConfig from "@firebase-config";

const env = import.meta?.env || {};

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || appletFirebaseConfig.apiKey,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || appletFirebaseConfig.authDomain,
  projectId: env.VITE_FIREBASE_PROJECT_ID || appletFirebaseConfig.projectId,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || appletFirebaseConfig.storageBucket,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || appletFirebaseConfig.messagingSenderId,
  appId: env.VITE_FIREBASE_APP_ID || appletFirebaseConfig.appId,
  firestoreDatabaseId:
    env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || appletFirebaseConfig.firestoreDatabaseId || "(default)",
};

export function validateFirebaseConfig() {
  const missing = [];
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey.includes("YOUR_")) missing.push("apiKey");
  if (!firebaseConfig.projectId || firebaseConfig.projectId.includes("remixed-")) {
    missing.push("projectId");
  }
  if (!firebaseConfig.appId) missing.push("appId");
  if (missing.length) {
    throw new Error(
      `Firebase configuration is incomplete (${missing.join(", ")}). Check firebase-applet-config.json or VITE_FIREBASE_* env vars.`
    );
  }
}

validateFirebaseConfig();

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const storage = getStorage(app);

// Persist authentication state across browser/app restarts on desktop and mobile
setPersistence(auth, browserLocalPersistence).catch(() => {
  // Fallback handled silently by Firebase Auth default persistence in restricted WebViews
});

export const OperationType = Object.freeze({
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  LIST: "list",
  GET: "get",
  WRITE: "write",
});

/**
 * Formats Firebase Auth / Firestore / Storage errors into clear user-facing messages.
 */
export function formatFirebaseErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  const code = error?.code || "";
  const msg = String(error?.message || "");

  const authMap = {
    "auth/invalid-credential": "Incorrect email or password. Please check your credentials and try again.",
    "auth/user-not-found": "No UniMeet account was found with that email address.",
    "auth/wrong-password": "Incorrect password. Please try again or reset your password.",
    "auth/email-already-in-use": "An account with this email address already exists. Try signing in instead.",
    "auth/weak-password": "Password is too weak. Use at least 8 characters with letters and numbers.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/too-many-requests": "Too many attempts right now. Please wait a few minutes and try again.",
    "auth/user-disabled": "This account has been disabled. Contact support if this is unexpected.",
    "auth/network-request-failed": "Network request failed. Check your mobile data or Wi-Fi connection and retry.",
    "auth/operation-not-allowed": "Email/Password sign-in is not enabled yet in Firebase Authentication console.",
    "auth/expired-action-code": "This password reset link has expired. Request a new reset link.",
    "auth/invalid-action-code": "This password reset link is invalid or has already been used.",
    "auth/requires-recent-login": "Please sign in again before updating sensitive account details.",
    "storage/unauthorized": "You do not have permission to upload this image. Check Storage rules and file limits.",
    "storage/canceled": "Image upload was canceled.",
    "storage/quota-exceeded": "Storage quota exceeded. Please try a smaller image or preset.",
    "permission-denied": "You do not have permission to perform this action.",
    "unavailable": "Cloud Firestore is temporarily unreachable. Please retry in a moment.",
  };

  if (code && authMap[code]) {
    return authMap[code];
  }
  if (msg.includes("Quota exceeded")) {
    return "Daily Firebase free-tier quota exceeded. Please try again later.";
  }
  if (msg.includes("the client is offline")) {
    return "You appear to be offline or Firebase configuration is unreachable.";
  }
  // If handleFirestoreError already serialized JSON, avoid showing raw JSON in UI alerts
  if (msg.startsWith("{") && msg.includes('"operationType"')) {
    try {
      const parsed = JSON.parse(msg);
      return formatFirebaseErrorMessage({ message: parsed.error }, "Missing or insufficient permissions.");
    } catch {
      return fallback;
    }
  }
  return msg || fallback;
}

/**
 * Mandatory Firestore error logger & structured thrower per Firebase integration specification.
 */
export function handleFirestoreError(error, operationType, path) {
  const user = auth.currentUser;
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path: path ?? null,
    authInfo: {
      userId: user?.uid ?? null,
      email: user?.email ?? null,
      emailVerified: user?.emailVerified ?? null,
      isAnonymous: user?.isAnonymous ?? null,
      tenantId: user?.tenantId ?? null,
      providerInfo:
        user?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  const wrapped = new Error(JSON.stringify(errInfo));
  wrapped.userMessage = formatFirebaseErrorMessage(error);
  wrapped.code = error?.code;
  throw wrapped;
}

/**
 * Resolves with the initial Firebase Auth user (or null) once persistence state is hydrated.
 */
let authInitPromise = null;
export function waitForAuthInit() {
  if (!authInitPromise) {
    authInitPromise = new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(
        auth,
        (user) => {
          unsubscribe();
          resolve(user);
        },
        () => {
          unsubscribe();
          resolve(null);
        }
      );
    });
  }
  return authInitPromise;
}

/**
 * Validate Firestore connection on initial application boot.
 */
let connectionTestPromise = null;
export function testFirestoreConnection() {
  if (!connectionTestPromise) {
    connectionTestPromise = getDocFromServer(doc(db, "_health", "connection")).catch((error) => {
      if (error instanceof Error && error.message.includes("the client is offline")) {
        console.error("Please check your Firebase configuration.");
      }
      return null;
    });
  }
  return connectionTestPromise;
}

testFirestoreConnection();
