/**
 * UniMeet2026 Firebase Backend API Layer
 * Uses Firebase Authentication, Cloud Firestore (named DB), and Firebase Storage exclusively.
 * Zero FastAPI/REST/WebSocket/localhost calls.
 */
import {
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateEmail,
  updateProfile,
} from "firebase/auth";
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  limit as fsLimit,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from "firebase/storage";
import {
  CONFIG,
  INTERESTS_CATALOG,
  SUGGESTED_HOBBIES,
} from "./config.js";
import {
  auth,
  db,
  formatFirebaseErrorMessage,
  handleFirestoreError,
  OperationType,
  storage,
  waitForAuthInit,
} from "./firebase-client.js";
import { DemoStore } from "./demo-store.js";

const INTEREST_BY_NAME = new Map(INTERESTS_CATALOG.map((i) => [i.name.toLowerCase(), i]));
const INTEREST_BY_ID = new Map(INTERESTS_CATALOG.map((i) => [i.id, i]));

export function getFallbackToken() {
  if (DemoStore.isDemoSession()) return DemoStore.me().id;
  return auth.currentUser ? auth.currentUser.uid : "";
}

export function setFallbackToken() {
  // No-op kept for module export compatibility; Firebase Auth manages session tokens natively
}

function toIsoString(val) {
  if (!val) return new Date().toISOString();
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val?.toDate === "function") return val.toDate().toISOString();
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function makeError(message, status = 400, code = "") {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function mapInterestsToUiObjects(interestNames) {
  if (!Array.isArray(interestNames)) return [];
  return interestNames.map((raw) => {
    const str = String(raw || "").trim();
    const match = INTEREST_BY_NAME.get(str.toLowerCase()) || INTEREST_BY_ID.get(str);
    if (match) return { ...match };
    return { id: str.toLowerCase().replace(/[^a-z0-9_-]/g, "_"), name: str, category: "Community" };
  });
}

function mapUserDocToUi(data, email = null) {
  if (!data) return null;
  const hobbies = Array.isArray(data.hobbies) ? data.hobbies : [];
  const interests = mapInterestsToUiObjects(data.interests || []);
  return {
    id: data.uid,
    uid: data.uid,
    username: data.username || "student",
    display_name: data.displayName || `${data.firstName || ""} ${data.lastName || ""}`.trim(),
    first_name: data.firstName || "",
    last_name: data.lastName || "",
    email: email || "",
    age: data.age ?? null,
    profile_picture: data.profilePicture || null,
    university: data.university || null,
    faculty: data.faculty || null,
    study_program: data.studyProgram || null,
    study_year: data.studyYear ?? null,
    city: data.city || null,
    bio: data.bio || null,
    interests,
    interest_names: Array.isArray(data.interests) ? data.interests : [],
    hobbies,
    liked_categories: Array.isArray(data.likedCategories) ? data.likedCategories : [],
    preferences: data.preferences || null,
    is_active: data.isActive !== false,
    is_verified: Boolean(data.isVerified),
    is_sample: Boolean(data.isSample),
    created_at: toIsoString(data.createdAt),
    updated_at: toIsoString(data.updatedAt),
  };
}

function mapEventDocToUi(data, likedSet = new Set(), joinedSet = new Set()) {
  const id = data.eventId;
  return {
    id,
    eventId: id,
    title: data.title,
    description: data.description,
    location: data.location,
    city: data.city,
    university: data.university || null,
    date: data.date,
    start_datetime: toIsoString(data.startTime),
    end_datetime: data.endTime ? toIsoString(data.endTime) : null,
    category: data.category,
    creator_id: data.organizerId,
    organizer_name: data.organizerName || "UniMeet Host",
    organizer_university: data.organizerUniversity || null,
    max_participants: data.maximumParticipants ?? null,
    participant_count: Number(data.participantCount ?? 0),
    like_count: Number(data.likeCount ?? 0),
    image_url: data.imageUrl || null,
    is_active: data.isActive !== false,
    is_sample: Boolean(data.isSample),
    is_liked: likedSet.has(id),
    is_joined: joinedSet.has(id),
    created_at: toIsoString(data.createdAt),
  };
}

function mapGroupDocToUi(data, myMemberships = new Map()) {
  const id = data.groupId;
  const mem = myMemberships.get(id);
  return {
    id,
    groupId: id,
    name: data.name,
    description: data.description,
    creator_id: data.creatorId,
    event_id: data.eventId || null,
    event_title: data.eventTitle || null,
    max_members: Number(data.maxMembers || 10),
    member_count: Number(data.memberCount || 1),
    is_public: data.isPublic !== false,
    university: data.university || null,
    location: data.location || null,
    interests_summary: data.interestsSummary || null,
    conversation_id: data.conversationId,
    is_sample: Boolean(data.isSample),
    is_member: Boolean(mem && mem.status === "active"),
    membership_status: mem ? mem.status : null,
    created_at: toIsoString(data.createdAt),
  };
}

export function computeCompatibility(userA, userB) {
  const interestsA = new Set((userA?.interest_names || userA?.interests?.map((i) => i.name || i) || []).map((x) => String(x).toLowerCase()));
  const interestsB = new Set((userB?.interest_names || userB?.interests?.map((i) => i.name || i) || []).map((x) => String(x).toLowerCase()));
  const sharedInterests = [...interestsA].filter((x) => interestsB.has(x));
  const unionInterests = new Set([...interestsA, ...interestsB]);

  const interestScore = unionInterests.size
    ? Math.min(60, Math.round((sharedInterests.length / unionInterests.size) * 90))
    : 0;

  const sameUniversity =
    Boolean(userA?.university && userB?.university) &&
    userA.university.trim().toLowerCase() === userB.university.trim().toLowerCase();
  const uniScore = sameUniversity ? 20 : 0;

  const sameCity =
    Boolean(userA?.city && userB?.city) &&
    userA.city.trim().toLowerCase() === userB.city.trim().toLowerCase();
  const cityScore = sameCity ? 10 : 0;

  const catsA = new Set((userA?.liked_categories || []).map((c) => String(c).toLowerCase()));
  const catsB = new Set((userB?.liked_categories || []).map((c) => String(c).toLowerCase()));
  const sharedCats = [...catsA].filter((c) => catsB.has(c));
  const unionCats = new Set([...catsA, ...catsB]);
  const categoryScore = unionCats.size ? Math.round((sharedCats.length / unionCats.size) * 10) : 0;

  const compatibility = Math.min(100, interestScore + uniScore + cityScore + categoryScore);
  const reasons = [];
  if (sharedInterests.length) {
    reasons.push(`${sharedInterests.length} shared interest${sharedInterests.length === 1 ? "" : "s"}`);
  }
  if (sameUniversity) reasons.push(`same university (${userA.university})`);
  if (sameCity) reasons.push(`same city (${userA.city})`);
  if (sharedCats.length) reasons.push(`similar event tastes (${sharedCats.slice(0, 2).join(", ")})`);

  return {
    compatibility,
    shared_interests: sharedInterests.map(
      (lower) => INTEREST_BY_NAME.get(lower)?.name || lower
    ),
    same_university: sameUniversity,
    same_city: sameCity,
    explanation: reasons.length ? `Matched on ${reasons.join(" · ")}.` : "Open student community match.",
  };
}

function generateId(prefix) {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

async function getBlockedUserIds(uid) {
  if (!uid) return new Set();
  const path = `users/${uid}/blocked`;
  try {
    const snap = await getDocs(query(collection(db, path), where("blockerId", "==", uid)));
    return new Set(snap.docs.map((d) => d.id));
  } catch (err) {
    if (err?.code === "permission-denied") handleFirestoreError(err, OperationType.LIST, path);
    return new Set();
  }
}

async function getUserMapByIds(uids) {
  const unique = [...new Set((uids || []).filter(Boolean))];
  const map = new Map();
  await Promise.all(
    unique.map(async (uid) => {
      try {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) {
          map.set(uid, mapUserDocToUi(snap.data()));
        }
      } catch {
        // Ignore single missing profile
      }
    })
  );
  return map;
}

function isFirestorePermError(err) {
  return err?.code === "permission-denied" || String(err?.message || "").includes("Missing or insufficient permissions");
}

function wrapFriendlyAuthError(err, fallback) {
  const friendly = formatFirebaseErrorMessage(err, fallback);
  const out = makeError(friendly, err?.code === "auth/network-request-failed" ? 503 : 400, err?.code);
  return out;
}

export const API = {
  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------
  async register(payload) {
    DemoStore.clearOfflineDemoSession();
    let cred = null;
    try {
      cred = await createUserWithEmailAndPassword(auth, payload.email, payload.password);
      const uid = cred.user.uid;
      const username = String(payload.username).trim();
      const usernameKey = username.toLowerCase();
      const displayName = `${payload.first_name} ${payload.last_name}`.trim() || username;

      await updateProfile(cred.user, { displayName });

      const usernameRef = doc(db, "usernames", usernameKey);
      const existingUsername = await getDoc(usernameRef);
      if (existingUsername.exists()) {
        await cred.user.delete().catch(() => {});
        throw makeError("That username is already taken. Please choose another one.", 409, "username-taken");
      }

      const now = serverTimestamp();
      const batch = writeBatch(db);
      batch.set(usernameRef, {
        uid,
        username,
        createdAt: now,
      });
      batch.set(doc(db, "users", uid), {
        uid,
        username,
        displayName,
        firstName: payload.first_name,
        lastName: payload.last_name,
        age: payload.age ?? null,
        profilePicture: null,
        university: payload.university || null,
        city: payload.city || null,
        bio: null,
        interests: [],
        hobbies: [],
        likedCategories: [],
        isActive: true,
        isVerified: false,
        isSample: false,
        createdAt: now,
        updatedAt: now,
      });
      batch.set(doc(db, "users", uid, "private", "info"), {
        uid,
        email: payload.email,
        updatedAt: now,
      });

      await batch.commit();
      return await API.me({ skipAuthRedirect: true });
    } catch (err) {
      if (cred?.user && err?.code !== "username-taken" && !err?.status) {
        // Clean up orphan auth account if profile creation failed due to rules/network
        await cred.user.delete().catch(() => {});
      }
      if (isFirestorePermError(err)) {
        handleFirestoreError(err, OperationType.WRITE, `users/${cred?.user?.uid || "new"}`);
      }
      if (err?.status === 409) throw err;
      throw wrapFriendlyAuthError(err, "Registration failed. Please check your details and try again.");
    }
  },

  async _provisionDemoUserProfile(fbUser) {
    const demo = CONFIG.DEMO_ACCOUNT;
    const uid = fbUser.uid;
    const displayName = `${demo.first_name} ${demo.last_name}`.trim();
    await updateProfile(fbUser, { displayName }).catch(() => {});

    let finalUsername = demo.username;
    const primaryUsernameRef = doc(db, "usernames", finalUsername.toLowerCase());
    const primarySnap = await getDoc(primaryUsernameRef).catch(() => null);
    if (primarySnap?.exists() && primarySnap.data()?.uid !== uid) {
      finalUsername = `${demo.username}_${uid.slice(0, 5)}`;
    }

    const now = serverTimestamp();
    const batch = writeBatch(db);
    batch.set(doc(db, "usernames", finalUsername.toLowerCase()), {
      uid,
      username: finalUsername,
      createdAt: now,
    });
    batch.set(doc(db, "users", uid), {
      uid,
      username: finalUsername,
      displayName,
      firstName: demo.first_name,
      lastName: demo.last_name,
      age: demo.age,
      profilePicture: null,
      university: demo.university,
      city: demo.city,
      bio: demo.bio,
      interests: demo.interests,
      hobbies: demo.hobbies,
      likedCategories: demo.likedCategories,
      isActive: true,
      isVerified: false,
      isSample: false,
      createdAt: now,
      updatedAt: now,
    });
    batch.set(doc(db, "users", uid, "private", "info"), {
      uid,
      email: demo.email,
      updatedAt: now,
    });
    await batch.commit();

    // Seed starter sample outings if none exist yet so the demo student sees plans immediately
    const existingEvents = await getDocs(query(collection(db, "events"), where("isActive", "==", true), fsLimit(1))).catch(() => null);
    if (existingEvents && existingEvents.empty) {
      await API.seedSampleEvents().catch(() => {});
    }
  },

  async loginWithDemoAccount() {
    const demo = CONFIG.DEMO_ACCOUNT;
    try {
      const cred = await signInWithEmailAndPassword(auth, demo.email, demo.password);
      const userSnap = await getDoc(doc(db, "users", cred.user.uid)).catch(() => null);
      if (!userSnap || !userSnap.exists()) {
        await API._provisionDemoUserProfile(cred.user).catch(() => {});
      }
      DemoStore.ensureInitialized();
      return await API.me({ skipAuthRedirect: true });
    } catch (err) {
      if (err?.code === "auth/user-not-found" || err?.code === "auth/invalid-credential") {
        try {
          const cred = await createUserWithEmailAndPassword(auth, demo.email, demo.password);
          await API._provisionDemoUserProfile(cred.user).catch(() => {});
          DemoStore.ensureInitialized();
          return await API.me({ skipAuthRedirect: true });
        } catch (createErr) {
          if (createErr?.code === "auth/email-already-in-use") {
            DemoStore.activateOfflineDemoSession();
            return DemoStore.me();
          }
          DemoStore.activateOfflineDemoSession();
          return DemoStore.me();
        }
      }
      if (
        err?.code === "auth/network-request-failed" ||
        err?.code === "auth/too-many-requests" ||
        err?.code === "auth/operation-not-allowed"
      ) {
        DemoStore.activateOfflineDemoSession();
        return DemoStore.me();
      }
      if (isFirestorePermError(err)) {
        DemoStore.ensureInitialized();
        return DemoStore.me();
      }
      throw wrapFriendlyAuthError(err, "Could not sign in to the demo account.");
    }
  },

  async login({ identifier, password }) {
    const trimmed = String(identifier || "").trim();
    if (!trimmed.includes("@")) {
      throw makeError("Please sign in using your registered email address.", 400);
    }
    if (
      trimmed.toLowerCase() === CONFIG.DEMO_ACCOUNT.email &&
      password === CONFIG.DEMO_ACCOUNT.password
    ) {
      return API.loginWithDemoAccount();
    }
    DemoStore.clearOfflineDemoSession();
    try {
      const cred = await signInWithEmailAndPassword(auth, trimmed, password);
      // Ensure user profile doc exists (recovers gracefully if user was created in Console)
      const userRef = doc(db, "users", cred.user.uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        const displayName = cred.user.displayName || trimmed.split("@")[0];
        const [firstName, ...rest] = displayName.split(" ");
        const lastName = rest.join(" ") || "Student";
        const fallbackUsername = `${trimmed.split("@")[0].replace(/[^a-zA-Z0-9_.-]/g, "")}_${cred.user.uid.slice(0, 4)}`.slice(0, 40);
        const now = serverTimestamp();
        const batch = writeBatch(db);
        batch.set(userRef, {
          uid: cred.user.uid,
          username: fallbackUsername,
          displayName,
          firstName: firstName || "UniMeet",
          lastName,
          interests: [],
          hobbies: [],
          likedCategories: [],
          isActive: true,
          isVerified: false,
          isSample: false,
          createdAt: now,
          updatedAt: now,
        });
        batch.set(doc(db, "users", cred.user.uid, "private", "info"), {
          uid: cred.user.uid,
          email: cred.user.email || trimmed,
          updatedAt: now,
        });
        await batch.commit().catch(() => {});
      }
      return await API.me({ skipAuthRedirect: true });
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.GET, `users/${auth.currentUser?.uid}`);
      throw wrapFriendlyAuthError(err, "Unable to sign in right now. Please try again.");
    }
  },

  async logout() {
    DemoStore.clearOfflineDemoSession();
    await signOut(auth).catch(() => {});
  },

  async forgotPassword(email) {
    try {
      await sendPasswordResetEmail(auth, String(email).trim());
      return {
        message: "Password reset email sent. Check your inbox (and spam folder) for the Firebase reset link.",
      };
    } catch (err) {
      throw wrapFriendlyAuthError(err, "Could not send password reset email.");
    }
  },

  async resetPassword(oobCode, newPassword) {
    try {
      await confirmPasswordReset(auth, oobCode, newPassword);
      return {
        message: "Password updated successfully. You can now sign in with your new password.",
      };
    } catch (err) {
      throw wrapFriendlyAuthError(err, "Could not update password. Request a new reset link and try again.");
    }
  },

  async sendVerificationEmail() {
    const fbUser = auth.currentUser;
    if (!fbUser) throw makeError("Sign in required.", 401);
    try {
      await sendEmailVerification(fbUser);
      return { message: "Verification email sent. Open the link in your inbox to verify your account." };
    } catch (err) {
      throw wrapFriendlyAuthError(err, "Could not send verification email right now.");
    }
  },

  async me({ skipAuthRedirect = false } = {}) {
    await waitForAuthInit();
    if (DemoStore.isDemoSession()) {
      return DemoStore.me();
    }
    const fbUser = auth.currentUser;
    if (!fbUser) {
      if (!skipAuthRedirect && typeof window !== "undefined") {
        window.location.href = "login.html";
      }
      return null;
    }

    const userPath = `users/${fbUser.uid}`;
    try {
      const [profileSnap, privateSnap] = await Promise.all([
        getDoc(doc(db, "users", fbUser.uid)),
        getDoc(doc(db, "users", fbUser.uid, "private", "info")).catch(() => null),
      ]);
      const email = privateSnap?.exists() ? privateSnap.data().email : fbUser.email;
      if (!profileSnap.exists()) {
        return {
          id: fbUser.uid,
          uid: fbUser.uid,
          username: (fbUser.email || "student").split("@")[0],
          first_name: fbUser.displayName?.split(" ")[0] || "UniMeet",
          last_name: fbUser.displayName?.split(" ").slice(1).join(" ") || "Student",
          email: fbUser.email || "",
          interests: [],
          interest_names: [],
          hobbies: [],
          liked_categories: [],
          is_verified: Boolean(fbUser.emailVerified),
          is_active: true,
        };
      }
      const mapped = mapUserDocToUi(profileSnap.data(), email);
      mapped.email_verified = Boolean(fbUser.emailVerified);
      mapped.is_verified = Boolean(fbUser.emailVerified || mapped.is_verified);
      return mapped;
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.GET, userPath);
      throw wrapFriendlyAuthError(err, "Could not load your profile.");
    }
  },

  // ---------------------------------------------------------------------------
  // User Profile, Hobbies & Interests
  // ---------------------------------------------------------------------------
  async getMyProfile() {
    return API.me();
  },

  async getUserProfile(uid) {
    if (DemoStore.isDemoSession()) return DemoStore.getUserProfile(uid);
    const path = `users/${uid}`;
    try {
      const snap = await getDoc(doc(db, "users", String(uid)));
      if (!snap.exists()) throw makeError("User profile not found.", 404);
      const target = mapUserDocToUi(snap.data());
      const me = await API.me({ skipAuthRedirect: true }).catch(() => null);
      if (me && me.id !== target.id) {
        target.compatibility = computeCompatibility(me, target);
      }
      return target;
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.GET, path);
      throw err;
    }
  },

  async updateMyProfile(payload) {
    if (DemoStore.isDemoSession()) return DemoStore.updateMyProfile(payload);
    const fbUser = auth.currentUser;
    if (!fbUser) throw makeError("Sign in required.", 401);
    const uid = fbUser.uid;
    const path = `users/${uid}`;

    try {
      const currentSnap = await getDoc(doc(db, "users", uid));
      const current = currentSnap.exists() ? currentSnap.data() : {};
      const nextUsername = String(payload.username || current.username).trim();
      const prevUsername = String(current.username || "").trim();

      if (nextUsername.toLowerCase() !== prevUsername.toLowerCase()) {
        const nextKeyRef = doc(db, "usernames", nextUsername.toLowerCase());
        const existing = await getDoc(nextKeyRef);
        if (existing.exists() && existing.data().uid !== uid) {
          throw makeError("That username is already taken.", 409);
        }
        await setDoc(nextKeyRef, { uid, username: nextUsername, createdAt: serverTimestamp() });
        if (prevUsername) {
          await deleteDoc(doc(db, "usernames", prevUsername.toLowerCase())).catch(() => {});
        }
      }

      const displayName = `${payload.first_name} ${payload.last_name}`.trim() || nextUsername;
      const batch = writeBatch(db);
      batch.update(doc(db, "users", uid), {
        firstName: payload.first_name,
        lastName: payload.last_name,
        displayName,
        username: nextUsername,
        age: payload.age ? Number(payload.age) : null,
        city: payload.city || null,
        university: payload.university || null,
        profilePicture: payload.profile_picture || null,
        bio: payload.bio || null,
        hobbies: Array.isArray(payload.hobbies) ? payload.hobbies.slice(0, 20) : current.hobbies || [],
        updatedAt: serverTimestamp(),
      });

      if (payload.email && payload.email !== fbUser.email) {
        await updateEmail(fbUser, payload.email).catch((e) => {
          throw wrapFriendlyAuthError(e, "Could not update account email.");
        });
        batch.set(
          doc(db, "users", uid, "private", "info"),
          { uid, email: payload.email, updatedAt: serverTimestamp() },
          { merge: true }
        );
      }

      await updateProfile(fbUser, {
        displayName,
        photoURL: payload.profile_picture || null,
      }).catch(() => {});

      await batch.commit();
      return await API.me({ skipAuthRedirect: true });
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.UPDATE, path);
      if (err?.status) throw err;
      throw wrapFriendlyAuthError(err, "Could not save profile.");
    }
  },

  async getMyHobbies() {
    if (DemoStore.isDemoSession()) return DemoStore.getMyHobbies();
    const me = await API.me();
    return {
      selected_hobbies: me?.hobbies || [],
      suggested_hobbies: SUGGESTED_HOBBIES,
    };
  },

  async updateMyHobbies(hobbies) {
    if (DemoStore.isDemoSession()) return DemoStore.updateMyHobbies(hobbies);
    const fbUser = auth.currentUser;
    if (!fbUser) throw makeError("Sign in required.", 401);
    const cleaned = [...new Set((hobbies || []).map((h) => String(h).trim()).filter(Boolean))].slice(0, 20);
    const path = `users/${fbUser.uid}`;
    try {
      await updateDoc(doc(db, "users", fbUser.uid), {
        hobbies: cleaned,
        updatedAt: serverTimestamp(),
      });
      return {
        selected_hobbies: cleaned,
        suggested_hobbies: SUGGESTED_HOBBIES,
      };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.UPDATE, path);
      throw wrapFriendlyAuthError(err, "Could not update hobbies.");
    }
  },

  async getMyInterests() {
    if (DemoStore.isDemoSession()) return DemoStore.getMyInterests();
    const me = await API.me();
    return {
      available_interests: INTERESTS_CATALOG,
      selected_interests: me?.interests || [],
    };
  },

  async updateMyInterests(interestIdsOrNames) {
    if (DemoStore.isDemoSession()) return DemoStore.updateMyInterests(interestIdsOrNames);
    const fbUser = auth.currentUser;
    if (!fbUser) throw makeError("Sign in required.", 401);
    const names = [...new Set((interestIdsOrNames || []).map((val) => {
      const byId = INTEREST_BY_ID.get(String(val));
      if (byId) return byId.name;
      const byName = INTEREST_BY_NAME.get(String(val).toLowerCase());
      return byName ? byName.name : String(val);
    }))].slice(0, 30);

    const path = `users/${fbUser.uid}`;
    try {
      await updateDoc(doc(db, "users", fbUser.uid), {
        interests: names,
        updatedAt: serverTimestamp(),
      });
      return {
        available_interests: INTERESTS_CATALOG,
        selected_interests: mapInterestsToUiObjects(names),
      };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.UPDATE, path);
      throw wrapFriendlyAuthError(err, "Could not update interests.");
    }
  },

  // ---------------------------------------------------------------------------
  // Discovery & Community
  // ---------------------------------------------------------------------------
  async discoverUsers({ city = "", university = "", q = "", relation = "all", limit = 30 } = {}) {
    if (DemoStore.isDemoSession()) return DemoStore.discoverUsers({ city, university, q, relation, limit });
    const me = await API.me();
    if (!me) return [];
    const path = "users";
    try {
      const [snap, blocked] = await Promise.all([
        getDocs(query(collection(db, "users"), where("isActive", "==", true), fsLimit(Math.max(limit, 40)))),
        getBlockedUserIds(me.id),
      ]);
      const cityFilter = city.trim().toLowerCase();
      const uniFilter = university.trim().toLowerCase();
      const qLow = q.trim().toLowerCase();

      return snap.docs
        .map((d) => mapUserDocToUi(d.data()))
        .filter((u) => {
          if (u.id === me.id || blocked.has(u.id)) return false;
          if (cityFilter && !(u.city || "").toLowerCase().includes(cityFilter)) return false;
          if (uniFilter && !(u.university || "").toLowerCase().includes(uniFilter)) return false;
          if (qLow && !`${u.first_name} ${u.last_name} ${u.username} ${u.bio || ""}`.toLowerCase().includes(qLow)) return false;
          return true;
        })
        .map((u) => ({
          ...u,
          compatibility: computeCompatibility(me, u),
        }))
        .sort((a, b) => (b.compatibility?.compatibility || 0) - (a.compatibility?.compatibility || 0))
        .slice(0, limit);
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.LIST, path);
      throw wrapFriendlyAuthError(err, "Could not load people discovery.");
    }
  },

  async getCommunity({ university = "", city = "", q = "", relation = "all" } = {}) {
    if (DemoStore.isDemoSession()) return DemoStore.getCommunity({ university, city, q, relation });
    const fbUser = auth.currentUser || (await waitForAuthInit());
    if (!fbUser) {
      return { university: university || null, students: [] };
    }
    const me = await API.me({ skipAuthRedirect: true });
    const students = await API.discoverUsers({ university, city, q, relation, limit: 40 });
    return {
      university: university || null,
      students: me ? students : students,
    };
  },

  async listUniversities() {
    if (DemoStore.isDemoSession()) return DemoStore.listUniversities();
    const fbUser = auth.currentUser || (await waitForAuthInit());
    if (!fbUser) return [];
    const path = "users";
    try {
      const snap = await getDocs(query(collection(db, "users"), where("isActive", "==", true), fsLimit(80)));
      const counts = new Map();
      snap.docs.forEach((d) => {
        const uni = (d.data().university || "").trim();
        if (uni) counts.set(uni, (counts.get(uni) || 0) + 1);
      });
      return [...counts.entries()]
        .map(([university, student_count]) => ({ university, student_count }))
        .sort((a, b) => b.student_count - a.student_count);
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.LIST, path);
      return [];
    }
  },

  async toggleFollowUser(targetUid) {
    if (DemoStore.isDemoSession()) return DemoStore.toggleFollowUser(targetUid);
    throw makeError("Follow feature is currently preview-only for demo sessions.", 400);
  },

  async startDirectChatWithUser(targetUid) {
    if (DemoStore.isDemoSession()) return DemoStore.startDirectChatWithUser(targetUid);
    const me = await API.me();
    if (!me) throw makeError("Sign in required.", 401);
    const tUid = String(targetUid);
    const [minUid, maxUid] = [me.id, tUid].sort();
    const chatId = `dm_${minUid}__${maxUid}`;
    const chatRef = doc(db, "chats", chatId);
    const existing = await getDoc(chatRef).catch(() => null);
    if (!existing || !existing.exists()) {
      const target = await API.getUserProfile(tUid);
      const now = serverTimestamp();
      await setDoc(chatRef, {
        chatId,
        participants: [minUid, maxUid],
        type: "direct",
        title: `${target.first_name} ${target.last_name}`.trim(),
        createdAt: now,
        updatedAt: now,
      });
    }
    return { conversation_id: chatId };
  },

  // ---------------------------------------------------------------------------
  // Events (CRUD, Join/Leave, Like/Unlike, Real-time listener, Sample Seeder)
  // ---------------------------------------------------------------------------
  async _getMyEventFlags(uid) {
    if (!uid) return { likedSet: new Set(), joinedSet: new Set() };
    const [likesSnap, partsSnap] = await Promise.all([
      getDocs(query(collection(db, "eventLikes"), where("userId", "==", uid))).catch(() => ({ docs: [] })),
      getDocs(query(collection(db, "eventParticipants"), where("userId", "==", uid), where("status", "==", "going"))).catch(() => ({ docs: [] })),
    ]);
    return {
      likedSet: new Set(likesSnap.docs.map((d) => d.data().eventId)),
      joinedSet: new Set(partsSnap.docs.map((d) => d.data().eventId)),
    };
  },

  async listEvents({ q = "", category = "", city = "", university = "", date = "", timeframe = "all", page = 1, limit = 9 } = {}) {
    if (DemoStore.isDemoSession()) {
      return DemoStore.listEvents({ q, category, city, university, date, timeframe, page, limit });
    }
    const path = "events";
    try {
      const fbUser = auth.currentUser || (await waitForAuthInit());
      const [evSnap, flags] = await Promise.all([
        getDocs(query(collection(db, "events"), where("isActive", "==", true), fsLimit(120))),
        API._getMyEventFlags(fbUser?.uid),
      ]);

      const qLow = q.trim().toLowerCase();
      const catLow = category.trim().toLowerCase();
      const cityLow = city.trim().toLowerCase();
      const uniLow = university.trim().toLowerCase();
      const dateFilter = date.trim();
      const nowMs = Date.now();

      const all = evSnap.docs
        .map((d) => mapEventDocToUi(d.data(), flags.likedSet, flags.joinedSet))
        .filter((ev) => {
          if (qLow && !`${ev.title} ${ev.description} ${ev.location}`.toLowerCase().includes(qLow)) return false;
          if (catLow && (ev.category || "").toLowerCase() !== catLow) return false;
          if (cityLow && !(ev.city || "").toLowerCase().includes(cityLow)) return false;
          if (uniLow && !(ev.university || "").toLowerCase().includes(uniLow)) return false;
          if (dateFilter && ev.date !== dateFilter) return false;
          if (timeframe === "upcoming" && new Date(ev.start_datetime).getTime() < nowMs) return false;
          if (timeframe === "past" && new Date(ev.start_datetime).getTime() >= nowMs) return false;
          return true;
        })
        .sort((a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime());

      const total = all.length;
      const pages = Math.max(1, Math.ceil(total / limit));
      const safePage = Math.min(Math.max(1, page), pages);
      const start = (safePage - 1) * limit;
      return {
        items: all.slice(start, start + limit),
        total,
        page: safePage,
        pages,
      };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.LIST, path);
      throw wrapFriendlyAuthError(err, "Could not load events.");
    }
  },

  subscribeToEvents(onUpdate, onError) {
    if (DemoStore.isDemoSession()) return DemoStore.subscribeToEvents(onUpdate);
    const qRef = query(collection(db, "events"), where("isActive", "==", true), fsLimit(100));
    return onSnapshot(
      qRef,
      async (snapshot) => {
        const fbUser = auth.currentUser;
        const flags = await API._getMyEventFlags(fbUser?.uid);
        const items = snapshot.docs
          .map((d) => mapEventDocToUi(d.data(), flags.likedSet, flags.joinedSet))
          .sort((a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime());
        onUpdate(items);
      },
      (err) => {
        if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.LIST, "events");
        if (onError) onError(err);
      }
    );
  },

  async seedSampleEvents() {
    if (DemoStore.isDemoSession()) return DemoStore.seedSampleEvents();
    const me = await API.me();
    if (!me) throw makeError("Sign in to load sample outings.", 401);
    const batch = writeBatch(db);
    const now = serverTimestamp();

    CONFIG.SAMPLE_EVENTS_TEMPLATES.forEach((tpl) => {
      const eventId = generateId("sample_ev");
      const dt = new Date(Date.now() + tpl.daysAhead * 86400 * 1000);
      dt.setHours(tpl.hour, 0, 0, 0);
      const startIso = dt.toISOString();

      batch.set(doc(db, "events", eventId), {
        eventId,
        title: tpl.title,
        description: tpl.description,
        location: tpl.location,
        city: tpl.city,
        university: tpl.university,
        date: startIso.slice(0, 10),
        startTime: startIso,
        category: tpl.category,
        organizerId: me.id,
        organizerName: `${me.first_name} ${me.last_name}`.trim() || me.username,
        organizerUniversity: me.university || null,
        maximumParticipants: tpl.maximumParticipants,
        participantCount: 1,
        likeCount: 0,
        imageUrl: tpl.imageUrl,
        isActive: true,
        isSample: true,
        createdAt: now,
        updatedAt: now,
      });

      batch.set(doc(db, "eventParticipants", `${eventId}__${me.id}`), {
        eventId,
        userId: me.id,
        joinedAt: now,
        status: "going",
      });
    });

    try {
      await batch.commit();
      return { count: CONFIG.SAMPLE_EVENTS_TEMPLATES.length };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.WRITE, "events");
      throw wrapFriendlyAuthError(err, "Could not load sample outings.");
    }
  },

  async getEvent(eventId) {
    if (DemoStore.isDemoSession()) return DemoStore.getEvent(eventId);
    const id = String(eventId);
    const path = `events/${id}`;
    try {
      const fbUser = auth.currentUser || (await waitForAuthInit());
      const [snap, flags] = await Promise.all([
        getDoc(doc(db, "events", id)),
        API._getMyEventFlags(fbUser?.uid),
      ]);
      if (!snap.exists()) throw makeError("Event not found.", 404);
      return mapEventDocToUi(snap.data(), flags.likedSet, flags.joinedSet);
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.GET, path);
      throw err;
    }
  },

  async getEventParticipants(eventId) {
    if (DemoStore.isDemoSession()) return DemoStore.getEventParticipants(eventId);
    const id = String(eventId);
    const path = "eventParticipants";
    try {
      const snap = await getDocs(
        query(collection(db, "eventParticipants"), where("eventId", "==", id), where("status", "==", "going"))
      );
      const userIds = snap.docs.map((d) => d.data().userId);
      const users = await getUserMapByIds(userIds);
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          user_id: data.userId,
          joined_at: toIsoString(data.joinedAt),
          user: users.get(data.userId) || {
            id: data.userId,
            first_name: "UniMeet",
            last_name: "Student",
            username: "student",
          },
        };
      });
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.LIST, path);
      throw wrapFriendlyAuthError(err, "Could not load participants.");
    }
  },

  async createEvent(payload) {
    if (DemoStore.isDemoSession()) return DemoStore.createEvent(payload);
    const me = await API.me();
    if (!me) throw makeError("Sign in required.", 401);
    const eventId = generateId("ev");
    const path = `events/${eventId}`;
    const startIso = new Date(payload.start_datetime).toISOString();
    const endIso = payload.end_datetime ? new Date(payload.end_datetime).toISOString() : null;
    const now = serverTimestamp();

    const eventDoc = {
      eventId,
      title: String(payload.title).trim(),
      description: String(payload.description).trim(),
      location: String(payload.location).trim(),
      city: String(payload.city).trim(),
      university: payload.university ? String(payload.university).trim() : null,
      date: startIso.slice(0, 10),
      startTime: startIso,
      endTime: endIso,
      category: String(payload.category).trim(),
      organizerId: me.id,
      organizerName: `${me.first_name} ${me.last_name}`.trim() || me.username,
      organizerUniversity: me.university || null,
      maximumParticipants: payload.max_participants ? Number(payload.max_participants) : null,
      participantCount: 1,
      likeCount: 0,
      imageUrl: payload.image_url || null,
      isActive: true,
      isSample: false,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, "events", eventId), eventDoc);
      batch.set(doc(db, "eventParticipants", `${eventId}__${me.id}`), {
        eventId,
        userId: me.id,
        joinedAt: now,
        status: "going",
      });
      await batch.commit();
      return await API.getEvent(eventId);
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.CREATE, path);
      throw wrapFriendlyAuthError(err, "Could not publish event.");
    }
  },

  async updateEvent(eventId, payload) {
    if (DemoStore.isDemoSession()) return DemoStore.updateEvent(eventId, payload);
    const id = String(eventId);
    const fbUser = auth.currentUser;
    if (!fbUser) throw makeError("Sign in required.", 401);
    const path = `events/${id}`;
    try {
      const startIso = payload.start_datetime ? new Date(payload.start_datetime).toISOString() : undefined;
      const updates = {
        ...(payload.title ? { title: String(payload.title).trim() } : {}),
        ...(payload.description ? { description: String(payload.description).trim() } : {}),
        ...(payload.location ? { location: String(payload.location).trim() } : {}),
        ...(payload.city ? { city: String(payload.city).trim() } : {}),
        ...(payload.category ? { category: String(payload.category).trim() } : {}),
        ...(payload.university !== undefined ? { university: payload.university || null } : {}),
        ...(startIso ? { startTime: startIso, date: startIso.slice(0, 10) } : {}),
        ...(payload.max_participants !== undefined
          ? { maximumParticipants: payload.max_participants ? Number(payload.max_participants) : null }
          : {}),
        ...(payload.image_url !== undefined ? { imageUrl: payload.image_url || null } : {}),
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, "events", id), updates);
      return await API.getEvent(id);
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.UPDATE, path);
      throw wrapFriendlyAuthError(err, "Could not update event.");
    }
  },

  async deleteEvent(eventId) {
    if (DemoStore.isDemoSession()) return DemoStore.deleteEvent(eventId);
    const id = String(eventId);
    const path = `events/${id}`;
    try {
      await deleteDoc(doc(db, "events", id));
      return { ok: true };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.DELETE, path);
      throw wrapFriendlyAuthError(err, "Could not delete event.");
    }
  },

  async joinEvent(eventId) {
    if (DemoStore.isDemoSession()) return DemoStore.joinEvent(eventId);
    const id = String(eventId);
    const fbUser = auth.currentUser;
    if (!fbUser) throw makeError("Sign in required.", 401);
    const path = `events/${id}`;
    try {
      await runTransaction(db, async (tx) => {
        const evRef = doc(db, "events", id);
        const partRef = doc(db, "eventParticipants", `${id}__${fbUser.uid}`);
        const [evSnap, partSnap] = await Promise.all([tx.get(evRef), tx.get(partRef)]);
        if (!evSnap.exists()) throw makeError("Event not found.", 404);
        if (partSnap.exists()) throw makeError("You have already joined this event.", 409);
        const ev = evSnap.data();
        if (ev.maximumParticipants && ev.participantCount >= ev.maximumParticipants) {
          throw makeError("This event is already full.", 409);
        }
        const now = serverTimestamp();
        tx.set(partRef, { eventId: id, userId: fbUser.uid, joinedAt: now, status: "going" });
        tx.update(evRef, { participantCount: (ev.participantCount || 0) + 1, updatedAt: now });
      });
      return await API.getEvent(id);
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.WRITE, path);
      if (err?.status) throw err;
      throw wrapFriendlyAuthError(err, "Could not join event.");
    }
  },

  async leaveEvent(eventId) {
    if (DemoStore.isDemoSession()) return DemoStore.leaveEvent(eventId);
    const id = String(eventId);
    const fbUser = auth.currentUser;
    if (!fbUser) throw makeError("Sign in required.", 401);
    const path = `events/${id}`;
    try {
      await runTransaction(db, async (tx) => {
        const evRef = doc(db, "events", id);
        const partRef = doc(db, "eventParticipants", `${id}__${fbUser.uid}`);
        const [evSnap, partSnap] = await Promise.all([tx.get(evRef), tx.get(partRef)]);
        if (!evSnap.exists()) throw makeError("Event not found.", 404);
        if (!partSnap.exists()) throw makeError("You are not joined in this event.", 404);
        const ev = evSnap.data();
        tx.delete(partRef);
        tx.update(evRef, {
          participantCount: Math.max(0, (ev.participantCount || 1) - 1),
          updatedAt: serverTimestamp(),
        });
      });
      return await API.getEvent(id);
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.WRITE, path);
      if (err?.status) throw err;
      throw wrapFriendlyAuthError(err, "Could not leave event.");
    }
  },

  async likeEvent(eventId) {
    if (DemoStore.isDemoSession()) return DemoStore.likeEvent(eventId);
    const id = String(eventId);
    const fbUser = auth.currentUser;
    if (!fbUser) throw makeError("Sign in required.", 401);
    const path = `events/${id}`;
    let evData = null;

    try {
      await runTransaction(db, async (tx) => {
        const evRef = doc(db, "events", id);
        const likeRef = doc(db, "eventLikes", `${id}__${fbUser.uid}`);
        const [evSnap, likeSnap] = await Promise.all([tx.get(evRef), tx.get(likeRef)]);
        if (!evSnap.exists()) throw makeError("Event not found.", 404);
        evData = evSnap.data();
        if (likeSnap.exists()) throw makeError("You already liked this event.", 409);

        const now = serverTimestamp();
        tx.set(likeRef, { eventId: id, userId: fbUser.uid, createdAt: now });
        tx.update(evRef, { likeCount: (evData.likeCount || 0) + 1, updatedAt: now });
      });

      // Update user's likedCategories for compatibility scoring
      if (evData?.category) {
        await updateDoc(doc(db, "users", fbUser.uid), {
          likedCategories: arrayUnion(evData.category),
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      // Open/ensure direct chat with organizer if organizer is another user
      if (evData?.organizerId && evData.organizerId !== fbUser.uid) {
        const [minUid, maxUid] = [fbUser.uid, evData.organizerId].sort();
        const chatId = `ev_${id}__${minUid}__${maxUid}`;
        const chatRef = doc(db, "chats", chatId);
        const existingChat = await getDoc(chatRef).catch(() => null);
        if (!existingChat || !existingChat.exists()) {
          const msgId = generateId("msg");
          const now = serverTimestamp();
          const batch = writeBatch(db);
          batch.set(chatRef, {
            chatId,
            participants: [minUid, maxUid],
            type: "event",
            eventId: id,
            title: evData.title,
            lastMessage: `Liked "${evData.title}" — say hello!`,
            lastMessageAt: now,
            lastMessageSenderId: fbUser.uid,
            createdAt: now,
            updatedAt: now,
          });
          batch.set(doc(db, "chats", chatId, "messages", msgId), {
            messageId: msgId,
            chatId,
            senderId: fbUser.uid,
            content: `Hi! I liked your outing "${evData.title}" and would love to hear more.`,
            timestamp: now,
            readBy: [fbUser.uid],
            isUnsent: false,
            hiddenFor: [],
          });
          await batch.commit().catch(() => {});
        }
      }

      return await API.getEvent(id);
    } catch (err) {
      if (err?.status === 409) return await API.getEvent(id);
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.WRITE, path);
      throw wrapFriendlyAuthError(err, "Could not like event.");
    }
  },

  async unlikeEvent(eventId) {
    if (DemoStore.isDemoSession()) return DemoStore.unlikeEvent(eventId);
    const id = String(eventId);
    const fbUser = auth.currentUser;
    if (!fbUser) throw makeError("Sign in required.", 401);
    const path = `events/${id}`;
    try {
      await runTransaction(db, async (tx) => {
        const evRef = doc(db, "events", id);
        const likeRef = doc(db, "eventLikes", `${id}__${fbUser.uid}`);
        const [evSnap, likeSnap] = await Promise.all([tx.get(evRef), tx.get(likeRef)]);
        if (!evSnap.exists()) throw makeError("Event not found.", 404);
        if (!likeSnap.exists()) return;
        const ev = evSnap.data();
        tx.delete(likeRef);
        tx.update(evRef, {
          likeCount: Math.max(0, (ev.likeCount || 1) - 1),
          updatedAt: serverTimestamp(),
        });
      });
      return await API.getEvent(id);
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.WRITE, path);
      throw wrapFriendlyAuthError(err, "Could not unlike event.");
    }
  },

  // ---------------------------------------------------------------------------
  // Matches & User Likes
  // ---------------------------------------------------------------------------
  async likeUser(receiverId, eventId) {
    if (DemoStore.isDemoSession()) return DemoStore.likeUser(receiverId, eventId);
    const me = await API.me();
    if (!me) throw makeError("Sign in required.", 401);
    const rUid = String(receiverId);
    const eId = String(eventId);
    const likeId = `${me.id}__${rUid}__${eId}`;
    const reciprocalId = `${rUid}__${me.id}__${eId}`;

    try {
      const [likeSnap, recSnap, otherUser, eventObj] = await Promise.all([
        getDoc(doc(db, "userLikes", likeId)),
        getDoc(doc(db, "userLikes", reciprocalId)),
        API.getUserProfile(rUid),
        API.getEvent(eId),
      ]);

      if (likeSnap.exists()) {
        throw makeError("Already liked this person for this event.", 409);
      }

      const now = serverTimestamp();
      const batch = writeBatch(db);
      batch.set(doc(db, "userLikes", likeId), {
        senderId: me.id,
        receiverId: rUid,
        eventId: eId,
        createdAt: now,
      });

      if (recSnap.exists()) {
        const [minUid, maxUid] = [me.id, rUid].sort();
        const matchId = `${minUid}__${maxUid}__${eId}`;
        const chatId = `dm_${minUid}__${maxUid}`;
        const chatRef = doc(db, "chats", chatId);
        const existingChat = await getDoc(chatRef).catch(() => null);
        const compat = computeCompatibility(me, otherUser);

        if (!existingChat || !existingChat.exists()) {
          batch.set(chatRef, {
            chatId,
            participants: [minUid, maxUid],
            type: "direct",
            matchId,
            eventId: eId,
            title: `Match · ${eventObj.title}`,
            createdAt: now,
            updatedAt: now,
          });
        } else {
          batch.update(chatRef, { updatedAt: now });
        }

        batch.set(doc(db, "matches", matchId), {
          matchId,
          userIds: [minUid, maxUid],
          eventId: eId,
          eventTitle: eventObj.title,
          compatibilityScore: compat.compatibility,
          compatibilityDetails: compat,
          conversationId: chatId,
          status: "active",
          createdAt: now,
          updatedAt: now,
        });

        await batch.commit();
        return {
          is_match: true,
          match: {
            id: matchId,
            event_id: eId,
            event_title: eventObj.title,
            conversation_id: chatId,
            other_user: { ...otherUser, compatibility: compat },
          },
        };
      }

      await batch.commit();
      return { is_match: false, match: null };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.WRITE, `userLikes/${likeId}`);
      if (err?.status) throw err;
      throw wrapFriendlyAuthError(err, "Could not process like.");
    }
  },

  async listMatches() {
    if (DemoStore.isDemoSession()) return DemoStore.listMatches();
    const me = await API.me();
    if (!me) return [];
    const path = "matches";
    try {
      const [snap, blocked] = await Promise.all([
        getDocs(query(collection(db, "matches"), where("userIds", "array-contains", me.id))),
        getBlockedUserIds(me.id),
      ]);
      const activeDocs = snap.docs
        .map((d) => d.data())
        .filter((m) => m.status === "active");

      const otherIds = activeDocs
        .map((m) => m.userIds.find((u) => u !== me.id))
        .filter((uid) => uid && !blocked.has(uid));
      const userMap = await getUserMapByIds(otherIds);

      return activeDocs
        .filter((m) => {
          const otherId = m.userIds.find((u) => u !== me.id);
          return otherId && !blocked.has(otherId);
        })
        .map((m) => {
          const otherId = m.userIds.find((u) => u !== me.id);
          const other = userMap.get(otherId) || {
            id: otherId,
            first_name: "UniMeet",
            last_name: "Student",
            username: "student",
          };
          const compat = computeCompatibility(me, other);
          return {
            id: m.matchId,
            event_id: m.eventId,
            event_title: m.eventTitle,
            conversation_id: m.conversationId || null,
            created_at: toIsoString(m.createdAt),
            other_user: { ...other, compatibility: compat },
          };
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.LIST, path);
      throw wrapFriendlyAuthError(err, "Could not load matches.");
    }
  },

  async deleteMatch(matchId) {
    if (DemoStore.isDemoSession()) return DemoStore.deleteMatch(matchId);
    const id = String(matchId);
    const path = `matches/${id}`;
    try {
      await updateDoc(doc(db, "matches", id), {
        status: "unmatched",
        updatedAt: serverTimestamp(),
      });
      return { ok: true };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.UPDATE, path);
      throw wrapFriendlyAuthError(err, "Could not unmatch.");
    }
  },

  async listLikedEvents() {
    if (DemoStore.isDemoSession()) return DemoStore.listLikedEvents();
    const me = await API.me();
    if (!me) return [];
    const path = "eventLikes";
    try {
      const likesSnap = await getDocs(
        query(collection(db, "eventLikes"), where("userId", "==", me.id))
      );
      const eventIds = [...new Set(likesSnap.docs.map((d) => d.data().eventId))];
      const events = await Promise.all(
        eventIds.map((eid) =>
          getDoc(doc(db, "events", eid))
            .then((s) => (s.exists() ? mapEventDocToUi(s.data(), new Set(eventIds), new Set()) : null))
            .catch(() => null)
        )
      );
      const validEvents = events.filter(Boolean);
      const creatorMap = await getUserMapByIds(validEvents.map((e) => e.creator_id));

      return validEvents.map((ev) => {
        const [minUid, maxUid] = [me.id, ev.creator_id].sort();
        const convId = ev.creator_id !== me.id ? `ev_${ev.id}__${minUid}__${maxUid}` : null;
        return {
          event: ev,
          creator: creatorMap.get(ev.creator_id) || {
            id: ev.creator_id,
            first_name: ev.organizer_name?.split(" ")[0] || "Event",
            last_name: ev.organizer_name?.split(" ").slice(1).join(" ") || "Host",
            university: ev.organizer_university || ev.university || null,
          },
          conversation_id: convId,
        };
      });
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.LIST, path);
      throw wrapFriendlyAuthError(err, "Could not load liked events.");
    }
  },

  // ---------------------------------------------------------------------------
  // Groups & Memberships
  // ---------------------------------------------------------------------------
  async listGroups({ q = "", category = "", university = "", city = "" } = {}) {
    if (DemoStore.isDemoSession()) return DemoStore.listGroups({ q, category, university, city });
    const path = "groups";
    try {
      const fbUser = auth.currentUser || (await waitForAuthInit());
      const [publicSnap, myOwnedSnap, myMemSnap] = await Promise.all([
        getDocs(query(collection(db, "groups"), where("isPublic", "==", true), fsLimit(80))),
        fbUser
          ? getDocs(query(collection(db, "groups"), where("creatorId", "==", fbUser.uid))).catch(() => ({ docs: [] }))
          : Promise.resolve({ docs: [] }),
        fbUser
          ? getDocs(query(collection(db, "groupMembers"), where("userId", "==", fbUser.uid))).catch(() => ({ docs: [] }))
          : Promise.resolve({ docs: [] }),
      ]);

      const myMemberships = new Map();
      myMemSnap.docs.forEach((d) => {
        const data = d.data();
        myMemberships.set(data.groupId, data);
      });

      const byId = new Map();
      [...publicSnap.docs, ...myOwnedSnap.docs].forEach((d) => {
        byId.set(d.id, d.data());
      });

      const qLow = q.trim().toLowerCase();
      const uniLow = university.trim().toLowerCase();
      const cityLow = city.trim().toLowerCase();

      return [...byId.values()]
        .map((g) => mapGroupDocToUi(g, myMemberships))
        .filter((g) => {
          if (qLow && !`${g.name} ${g.description} ${g.interests_summary || ""}`.toLowerCase().includes(qLow)) {
            return false;
          }
          if (uniLow && !(g.university || "").toLowerCase().includes(uniLow)) return false;
          if (cityLow && !(g.location || "").toLowerCase().includes(cityLow)) return false;
          return true;
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.LIST, path);
      throw wrapFriendlyAuthError(err, "Could not load groups.");
    }
  },

  async createGroup(payload) {
    if (DemoStore.isDemoSession()) return DemoStore.createGroup(payload);
    const me = await API.me();
    if (!me) throw makeError("Sign in required.", 401);
    const groupId = generateId("grp");
    const conversationId = `grp_${groupId}`;
    const now = serverTimestamp();

    let eventTitle = null;
    if (payload.event_id) {
      const evSnap = await getDoc(doc(db, "events", String(payload.event_id))).catch(() => null);
      if (evSnap?.exists()) eventTitle = evSnap.data().title;
    }

    const batch = writeBatch(db);
    batch.set(doc(db, "groups", groupId), {
      groupId,
      name: String(payload.name).trim(),
      description: String(payload.description).trim(),
      creatorId: me.id,
      eventId: payload.event_id ? String(payload.event_id) : null,
      eventTitle,
      maxMembers: Number(payload.max_members || 8),
      memberCount: 1,
      isPublic: Boolean(payload.is_public),
      university: payload.university || null,
      location: payload.location || null,
      interestsSummary: payload.interests_summary || null,
      conversationId,
      isSample: false,
      createdAt: now,
      updatedAt: now,
    });
    batch.set(doc(db, "groupMembers", `${groupId}__${me.id}`), {
      groupId,
      userId: me.id,
      groupCreatorId: me.id,
      role: "admin",
      status: "active",
      joinedAt: now,
    });
    batch.set(doc(db, "chats", conversationId), {
      chatId: conversationId,
      participants: [me.id],
      type: "group",
      groupId,
      title: String(payload.name).trim(),
      createdAt: now,
      updatedAt: now,
    });

    try {
      await batch.commit();
      return { id: groupId, conversation_id: conversationId };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.CREATE, `groups/${groupId}`);
      throw wrapFriendlyAuthError(err, "Could not create group.");
    }
  },

  async getGroupMembers(groupId) {
    if (DemoStore.isDemoSession()) return DemoStore.getGroupMembers(groupId);
    const id = String(groupId);
    const path = "groupMembers";
    try {
      const fbUser = auth.currentUser;
      const [activeSnap, pendingSnap] = await Promise.all([
        getDocs(query(collection(db, "groupMembers"), where("groupId", "==", id), where("status", "==", "active"))),
        fbUser
          ? getDocs(
              query(
                collection(db, "groupMembers"),
                where("groupId", "==", id),
                where("groupCreatorId", "==", fbUser.uid)
              )
            ).catch(() => ({ docs: [] }))
          : Promise.resolve({ docs: [] }),
      ]);

      const merged = new Map();
      [...activeSnap.docs, ...pendingSnap.docs].forEach((d) => merged.set(d.id, d.data()));
      const userMap = await getUserMapByIds([...merged.values()].map((m) => m.userId));

      return [...merged.values()].map((m) => ({
        user_id: m.userId,
        role: m.role,
        status: m.status,
        joined_at: toIsoString(m.joinedAt),
        user: userMap.get(m.userId) || {
          id: m.userId,
          first_name: "UniMeet",
          last_name: "Member",
          username: "student",
        },
      }));
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.LIST, path);
      throw wrapFriendlyAuthError(err, "Could not load group members.");
    }
  },

  async joinGroup(groupId) {
    if (DemoStore.isDemoSession()) return DemoStore.joinGroup(groupId);
    const id = String(groupId);
    const fbUser = auth.currentUser;
    if (!fbUser) throw makeError("Sign in required.", 401);
    const path = `groups/${id}`;
    try {
      await runTransaction(db, async (tx) => {
        const grpRef = doc(db, "groups", id);
        const memRef = doc(db, "groupMembers", `${id}__${fbUser.uid}`);
        const [grpSnap, memSnap] = await Promise.all([tx.get(grpRef), tx.get(memRef)]);
        if (!grpSnap.exists()) throw makeError("Group not found.", 404);
        if (memSnap.exists()) throw makeError("You have already joined or requested this group.", 409);

        const grp = grpSnap.data();
        if (grp.memberCount >= grp.maxMembers) throw makeError("This group is already full.", 409);

        const now = serverTimestamp();
        if (grp.isPublic) {
          tx.set(memRef, {
            groupId: id,
            userId: fbUser.uid,
            groupCreatorId: grp.creatorId,
            role: "member",
            status: "active",
            joinedAt: now,
          });
          tx.update(grpRef, { memberCount: (grp.memberCount || 1) + 1, updatedAt: now });
          tx.update(doc(db, "chats", grp.conversationId), {
            participants: arrayUnion(fbUser.uid),
            updatedAt: now,
          });
        } else {
          tx.set(memRef, {
            groupId: id,
            userId: fbUser.uid,
            groupCreatorId: grp.creatorId,
            role: "member",
            status: "pending",
            joinedAt: now,
          });
        }
      });
      return { ok: true };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.WRITE, path);
      if (err?.status) throw err;
      throw wrapFriendlyAuthError(err, "Could not join group.");
    }
  },

  async declineGroupInvite(groupId) {
    if (DemoStore.isDemoSession()) return DemoStore.declineGroupInvite(groupId);
    return { ok: true };
  },

  async approveGroupMember(groupId, targetUid) {
    if (DemoStore.isDemoSession()) return DemoStore.approveGroupMember(groupId, targetUid);
    const id = String(groupId);
    const tUid = String(targetUid);
    const path = `groupMembers/${id}__${tUid}`;
    try {
      await runTransaction(db, async (tx) => {
        const grpRef = doc(db, "groups", id);
        const memRef = doc(db, "groupMembers", `${id}__${tUid}`);
        const [grpSnap, memSnap] = await Promise.all([tx.get(grpRef), tx.get(memRef)]);
        if (!grpSnap.exists() || !memSnap.exists()) throw makeError("Membership request not found.", 404);
        const grp = grpSnap.data();
        const now = serverTimestamp();
        tx.update(memRef, { status: "active" });
        tx.update(grpRef, { memberCount: (grp.memberCount || 1) + 1, updatedAt: now });
        tx.update(doc(db, "chats", grp.conversationId), {
          participants: arrayUnion(tUid),
          updatedAt: now,
        });
      });
      return { ok: true };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.UPDATE, path);
      throw wrapFriendlyAuthError(err, "Could not approve member.");
    }
  },

  async leaveGroup(groupId) {
    if (DemoStore.isDemoSession()) return DemoStore.leaveGroup(groupId);
    const id = String(groupId);
    const fbUser = auth.currentUser;
    if (!fbUser) throw makeError("Sign in required.", 401);
    const path = `groups/${id}`;
    try {
      await runTransaction(db, async (tx) => {
        const grpRef = doc(db, "groups", id);
        const memRef = doc(db, "groupMembers", `${id}__${fbUser.uid}`);
        const [grpSnap, memSnap] = await Promise.all([tx.get(grpRef), tx.get(memRef)]);
        if (!grpSnap.exists() || !memSnap.exists()) return;
        const grp = grpSnap.data();
        const mem = memSnap.data();
        const now = serverTimestamp();
        tx.delete(memRef);
        if (mem.status === "active") {
          tx.update(grpRef, {
            memberCount: Math.max(0, (grp.memberCount || 1) - 1),
            updatedAt: now,
          });
          tx.update(doc(db, "chats", grp.conversationId), {
            participants: arrayRemove(fbUser.uid),
            updatedAt: now,
          });
        }
      });
      return { ok: true };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.WRITE, path);
      throw wrapFriendlyAuthError(err, "Could not leave group.");
    }
  },

  async deleteGroup(groupId) {
    if (DemoStore.isDemoSession()) return DemoStore.deleteGroup(groupId);
    const id = String(groupId);
    const path = `groups/${id}`;
    try {
      await deleteDoc(doc(db, "groups", id));
      return { ok: true };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.DELETE, path);
      throw wrapFriendlyAuthError(err, "Could not delete group.");
    }
  },

  // ---------------------------------------------------------------------------
  // Going Solo
  // ---------------------------------------------------------------------------
  async listSolo({ city = "", university = "" } = {}) {
    if (DemoStore.isDemoSession()) return DemoStore.listSolo({ city, university });
    const path = "soloPosts";
    try {
      const fbUser = auth.currentUser || (await waitForAuthInit());
      const [snap, myInterestsSnap, blocked] = await Promise.all([
        getDocs(query(collection(db, "soloPosts"), where("status", "==", "active"), fsLimit(60))),
        fbUser
          ? getDocs(query(collection(db, "soloInterests"), where("userId", "==", fbUser.uid))).catch(() => ({ docs: [] }))
          : Promise.resolve({ docs: [] }),
        getBlockedUserIds(fbUser?.uid),
      ]);

      const expressedSet = new Set(myInterestsSnap.docs.map((d) => d.data().soloId));
      const nowMs = Date.now();
      const rawPosts = snap.docs
        .map((d) => d.data())
        .filter((s) => {
          if (blocked.has(s.userId)) return false;
          if (s.expiresAt && new Date(s.expiresAt).getTime() < nowMs) return false;
          return true;
        });

      const userMap = await getUserMapByIds(rawPosts.map((s) => s.userId));
      const me = fbUser ? await API.me({ skipAuthRedirect: true }).catch(() => null) : null;
      const cityLow = city.trim().toLowerCase();
      const uniLow = university.trim().toLowerCase();

      return rawPosts
        .map((s) => {
          const author = userMap.get(s.userId) || {
            id: s.userId,
            first_name: "UniMeet",
            last_name: "Student",
            username: "student",
            hobbies: [],
          };
          if (me && author.id !== me.id) {
            author.compatibility = computeCompatibility(me, author);
          }
          return {
            id: s.soloId,
            user_id: s.userId,
            event_id: s.eventId,
            event_title: s.eventTitle,
            event_city: s.eventCity,
            event_start_datetime: toIsoString(s.eventStartTime),
            message: s.message,
            status: s.status,
            interest_count: Number(s.interestCount || 0),
            is_sample: Boolean(s.isSample),
            has_expressed_interest: expressedSet.has(s.soloId),
            created_at: toIsoString(s.createdAt),
            expires_at: toIsoString(s.expiresAt),
            user: author,
          };
        })
        .filter((s) => {
          if (cityLow && !(s.event_city || "").toLowerCase().includes(cityLow)) return false;
          if (uniLow && !(s.user?.university || "").toLowerCase().includes(uniLow)) return false;
          return true;
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.LIST, path);
      throw wrapFriendlyAuthError(err, "Could not load Going Solo posts.");
    }
  },

  async createSolo({ event_id, message, expires_hours = 48 }) {
    if (DemoStore.isDemoSession()) return DemoStore.createSolo({ event_id, message, expires_hours });
    const me = await API.me();
    if (!me) throw makeError("Sign in required.", 401);
    const trimmedMsg = String(message || "").trim();
    if (trimmedMsg.length < 5) {
      throw makeError("Personal note must be at least 5 characters.", 400);
    }
    const ev = await API.getEvent(String(event_id));
    const soloId = generateId("solo");
    const expiresAt = new Date(Date.now() + Number(expires_hours) * 3600 * 1000).toISOString();
    const now = serverTimestamp();

    try {
      await setDoc(doc(db, "soloPosts", soloId), {
        soloId,
        userId: me.id,
        eventId: ev.id,
        eventTitle: ev.title,
        eventCity: ev.city,
        eventStartTime: ev.start_datetime,
        message: trimmedMsg,
        status: "active",
        interestCount: 0,
        isSample: false,
        createdAt: now,
        expiresAt,
        updatedAt: now,
      });
      return { id: soloId };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.CREATE, `soloPosts/${soloId}`);
      throw wrapFriendlyAuthError(err, "Could not publish Going Solo status.");
    }
  },

  async deleteSolo(soloId) {
    if (DemoStore.isDemoSession()) return DemoStore.deleteSolo(soloId);
    const id = String(soloId);
    const path = `soloPosts/${id}`;
    try {
      await updateDoc(doc(db, "soloPosts", id), {
        status: "inactive",
        updatedAt: serverTimestamp(),
      });
      return { ok: true };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.UPDATE, path);
      throw wrapFriendlyAuthError(err, "Could not deactivate Going Solo status.");
    }
  },

  async expressSoloInterest(soloId) {
    if (DemoStore.isDemoSession()) return DemoStore.expressSoloInterest(soloId);
    const id = String(soloId);
    const me = await API.me();
    if (!me) throw makeError("Sign in required.", 401);
    const path = `soloPosts/${id}`;

    try {
      let soloData = null;
      await runTransaction(db, async (tx) => {
        const soloRef = doc(db, "soloPosts", id);
        const intRef = doc(db, "soloInterests", `${id}__${me.id}`);
        const [soloSnap, intSnap] = await Promise.all([tx.get(soloRef), tx.get(intRef)]);
        if (!soloSnap.exists()) throw makeError("Going Solo post not found.", 404);
        soloData = soloSnap.data();
        if (intSnap.exists()) throw makeError("You already expressed interest.", 409);

        const now = serverTimestamp();
        tx.set(intRef, {
          soloId: id,
          userId: me.id,
          soloOwnerId: soloData.userId,
          createdAt: now,
        });
        tx.update(soloRef, {
          interestCount: (soloData.interestCount || 0) + 1,
          updatedAt: now,
        });
      });

      const [minUid, maxUid] = [me.id, soloData.userId].sort();
      const chatId = `dm_${minUid}__${maxUid}`;
      const chatRef = doc(db, "chats", chatId);
      const existingChat = await getDoc(chatRef).catch(() => null);
      const msgId = generateId("msg");
      const now = serverTimestamp();
      const previewMsg = `Interested in teaming up for ${soloData.eventTitle}!`;

      const batch = writeBatch(db);
      if (!existingChat || !existingChat.exists()) {
        batch.set(chatRef, {
          chatId,
          participants: [minUid, maxUid],
          type: "solo",
          eventId: soloData.eventId,
          title: `Going Solo · ${soloData.eventTitle}`,
          lastMessage: previewMsg,
          lastMessageAt: now,
          lastMessageSenderId: me.id,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        batch.update(chatRef, {
          lastMessage: previewMsg,
          lastMessageAt: now,
          lastMessageSenderId: me.id,
          updatedAt: now,
        });
      }
      batch.set(doc(db, "chats", chatId, "messages", msgId), {
        messageId: msgId,
        chatId,
        senderId: me.id,
        content: `Hey! I saw your Going Solo post for "${soloData.eventTitle}" — want to team up?`,
        timestamp: now,
        readBy: [me.id],
        isUnsent: false,
        hiddenFor: [],
      });
      await batch.commit();
      return { conversation_id: chatId };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.WRITE, path);
      if (err?.status) throw err;
      throw wrapFriendlyAuthError(err, "Could not express interest.");
    }
  },

  // ---------------------------------------------------------------------------
  // Real-Time Messaging (Firestore onSnapshot)
  // ---------------------------------------------------------------------------
  async _hydrateConversations(docs, me, blockedSet) {
    const otherUids = [];
    const groupIds = [];
    docs.forEach((c) => {
      if (c.type !== "group") {
        const other = (c.participants || []).find((u) => u !== me.id);
        if (other) otherUids.push(other);
      } else if (c.groupId) {
        groupIds.push(c.groupId);
      }
    });

    const [userMap, groupDocs] = await Promise.all([
      getUserMapByIds(otherUids),
      Promise.all(
        [...new Set(groupIds)].map((gid) =>
          getDoc(doc(db, "groups", gid))
            .then((s) => (s.exists() ? [gid, s.data()] : null))
            .catch(() => null)
        )
      ),
    ]);
    const groupMap = new Map(groupDocs.filter(Boolean));

    return docs
      .filter((c) => {
        if (c.type !== "group") {
          const otherId = (c.participants || []).find((u) => u !== me.id);
          return otherId && !blockedSet.has(otherId);
        }
        return true;
      })
      .map((c) => {
        const otherId = c.type !== "group" ? (c.participants || []).find((u) => u !== me.id) : null;
        const otherUser = otherId ? userMap.get(otherId) || null : null;
        const grp = c.groupId ? groupMap.get(c.groupId) : null;
        const title = otherUser
          ? `${otherUser.first_name} ${otherUser.last_name}`.trim()
          : c.title || grp?.name || "Conversation";
        return {
          id: c.chatId,
          chatId: c.chatId,
          type: c.type,
          group_id: c.groupId || null,
          group_creator_id: grp?.creatorId || null,
          event_id: c.eventId || null,
          title,
          other_user: otherUser,
          last_message: c.lastMessage || null,
          last_message_at: c.lastMessageAt ? toIsoString(c.lastMessageAt) : null,
          unread_count: 0,
          updated_at: toIsoString(c.updatedAt),
        };
      })
      .sort((a, b) => new Date(b.last_message_at || b.updated_at).getTime() - new Date(a.last_message_at || a.updated_at).getTime());
  },

  async listConversations() {
    if (DemoStore.isDemoSession()) return DemoStore.listConversations();
    const me = await API.me();
    if (!me) return [];
    const path = "chats";
    try {
      const [snap, blocked] = await Promise.all([
        getDocs(query(collection(db, "chats"), where("participants", "array-contains", me.id))),
        getBlockedUserIds(me.id),
      ]);
      return await API._hydrateConversations(snap.docs.map((d) => d.data()), me, blocked);
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.LIST, path);
      throw wrapFriendlyAuthError(err, "Could not load conversations.");
    }
  },

  subscribeToConversations(me, onUpdate, onError) {
    if (DemoStore.isDemoSession()) return DemoStore.subscribeToConversations(me, onUpdate);
    const qRef = query(collection(db, "chats"), where("participants", "array-contains", me.id));
    return onSnapshot(
      qRef,
      async (snapshot) => {
        const blocked = await getBlockedUserIds(me.id);
        const list = await API._hydrateConversations(
          snapshot.docs.map((d) => d.data()),
          me,
          blocked
        );
        onUpdate(list);
      },
      (err) => {
        if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.LIST, "chats");
        if (onError) onError(err);
      }
    );
  },

  async getConversation(chatId) {
    if (DemoStore.isDemoSession()) return DemoStore.getConversation(chatId);
    const id = String(chatId);
    const me = await API.me();
    if (!me) throw makeError("Sign in required.", 401);
    const path = `chats/${id}`;
    try {
      const [chatSnap, msgsSnap, blocked] = await Promise.all([
        getDoc(doc(db, "chats", id)),
        getDocs(query(collection(db, "chats", id, "messages"), orderBy("timestamp", "asc"))),
        getBlockedUserIds(me.id),
      ]);
      if (!chatSnap.exists()) throw makeError("Conversation not found.", 404);
      const [hydrated] = await API._hydrateConversations([chatSnap.data()], me, blocked);
      if (!hydrated) throw makeError("Conversation unavailable.", 403);
      const messages = msgsSnap.docs
        .map((d) => d.data())
        .filter((m) => !(m.hiddenFor || []).includes(me.id) && !blocked.has(m.senderId))
        .map((m) => ({
          id: m.messageId,
          chat_id: m.chatId,
          sender_id: m.senderId,
          content: m.isUnsent ? "This message was unsent" : m.content,
          is_unsent: Boolean(m.isUnsent),
          is_read: Array.isArray(m.readBy) && m.readBy.some((uid) => uid !== m.senderId),
          created_at: toIsoString(m.timestamp),
        }));
      return { conversation: hydrated, messages };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.GET, path);
      if (err?.status) throw err;
      throw wrapFriendlyAuthError(err, "Could not load conversation.");
    }
  },

  subscribeToMessages(chatId, me, onUpdate, onError) {
    if (DemoStore.isDemoSession()) return DemoStore.subscribeToMessages(chatId, me, onUpdate);
    const id = String(chatId);
    const path = `chats/${id}/messages`;
    const qRef = query(collection(db, path), orderBy("timestamp", "asc"));
    return onSnapshot(
      qRef,
      (snapshot) => {
        const messages = snapshot.docs
          .map((d) => d.data())
          .filter((m) => !(m.hiddenFor || []).includes(me.id))
          .map((m) => ({
            id: m.messageId,
            chat_id: m.chatId,
            sender_id: m.senderId,
            content: m.isUnsent ? "This message was unsent" : m.content,
            is_unsent: Boolean(m.isUnsent),
            is_read: Array.isArray(m.readBy) && m.readBy.some((uid) => uid !== m.senderId),
            created_at: toIsoString(m.timestamp),
          }));
        onUpdate(messages);
      },
      (err) => {
        if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.LIST, path);
        if (onError) onError(err);
      }
    );
  },

  async sendMessage(chatId, content) {
    if (DemoStore.isDemoSession()) return DemoStore.sendMessage(chatId, content);
    const id = String(chatId);
    const fbUser = auth.currentUser;
    if (!fbUser) throw makeError("Sign in required.", 401);
    const text = String(content || "").trim();
    if (!text) throw makeError("Message cannot be empty.", 400);
    const messageId = generateId("msg");
    const msgPath = `chats/${id}/messages/${messageId}`;
    const now = serverTimestamp();

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, "chats", id, "messages", messageId), {
        messageId,
        chatId: id,
        senderId: fbUser.uid,
        content: text,
        timestamp: now,
        readBy: [fbUser.uid],
        isUnsent: false,
        hiddenFor: [],
      });
      batch.update(doc(db, "chats", id), {
        lastMessage: text,
        lastMessageAt: now,
        lastMessageSenderId: fbUser.uid,
        updatedAt: now,
      });
      await batch.commit();
      return {
        id: messageId,
        chat_id: id,
        sender_id: fbUser.uid,
        content: text,
        is_unsent: false,
        is_read: false,
        created_at: new Date().toISOString(),
      };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.CREATE, msgPath);
      throw wrapFriendlyAuthError(err, "Failed to send message.");
    }
  },

  async markMessageRead(chatId, messageId) {
    if (DemoStore.isDemoSession()) return DemoStore.markMessageRead(chatId, messageId);
    const fbUser = auth.currentUser;
    if (!fbUser) return;
    const path = `chats/${chatId}/messages/${messageId}`;
    try {
      await updateDoc(doc(db, "chats", String(chatId), "messages", String(messageId)), {
        readBy: arrayUnion(fbUser.uid),
      });
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.UPDATE, path);
    }
  },

  async unsendMessage(chatId, messageId) {
    if (DemoStore.isDemoSession()) return DemoStore.unsendMessage(chatId, messageId);
    const path = `chats/${chatId}/messages/${messageId}`;
    try {
      await updateDoc(doc(db, "chats", String(chatId), "messages", String(messageId)), {
        isUnsent: true,
        content: "This message was unsent",
      });
      return {
        id: String(messageId),
        chat_id: String(chatId),
        sender_id: auth.currentUser?.uid,
        content: "This message was unsent",
        is_unsent: true,
      };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.UPDATE, path);
      throw wrapFriendlyAuthError(err, "Could not unsend message.");
    }
  },

  async deleteMessageForMe(chatId, messageId) {
    if (DemoStore.isDemoSession()) return DemoStore.deleteMessageForMe(chatId, messageId);
    const fbUser = auth.currentUser;
    if (!fbUser) throw makeError("Sign in required.", 401);
    const path = `chats/${chatId}/messages/${messageId}`;
    try {
      await updateDoc(doc(db, "chats", String(chatId), "messages", String(messageId)), {
        hiddenFor: arrayUnion(fbUser.uid),
      });
      return { ok: true };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.UPDATE, path);
      throw wrapFriendlyAuthError(err, "Could not delete message.");
    }
  },

  // ---------------------------------------------------------------------------
  // Social Feed Posts, Comments & Notifications
  // ---------------------------------------------------------------------------
  async listPosts(opts = {}) {
    if (DemoStore.isDemoSession()) return DemoStore.listPosts(opts);
    return [];
  },

  async createPost(payload) {
    if (DemoStore.isDemoSession()) return DemoStore.createPost(payload);
    throw makeError("Feed posts are available in the demo environment.", 400);
  },

  async deletePost(postId) {
    if (DemoStore.isDemoSession()) return DemoStore.deletePost(postId);
    return { ok: true };
  },

  async toggleLikePost(postId) {
    if (DemoStore.isDemoSession()) return DemoStore.toggleLikePost(postId);
    throw makeError("Post reactions are available in the demo environment.", 400);
  },

  async addComment(postId, content) {
    if (DemoStore.isDemoSession()) return DemoStore.addComment(postId, content);
    throw makeError("Comments are available in the demo environment.", 400);
  },

  async deleteComment(postId, commentId) {
    if (DemoStore.isDemoSession()) return DemoStore.deleteComment(postId, commentId);
    return { ok: true };
  },

  async listNotifications() {
    if (DemoStore.isDemoSession()) return DemoStore.listNotifications();
    return [];
  },

  getUnreadNotificationCount() {
    if (DemoStore.isDemoSession()) return DemoStore.getUnreadNotificationCount();
    return 0;
  },

  getUnreadMessageCount() {
    if (DemoStore.isDemoSession()) return DemoStore.getUnreadMessageCount();
    return 0;
  },

  async markNotificationRead(notifId) {
    if (DemoStore.isDemoSession()) return DemoStore.markNotificationRead(notifId);
    return { ok: true };
  },

  async markAllNotificationsRead() {
    if (DemoStore.isDemoSession()) return DemoStore.markAllNotificationsRead();
    return { ok: true };
  },

  subscribeToNotifications(cb) {
    if (DemoStore.isDemoSession()) return DemoStore.subscribeToNotifications(cb);
    return () => {};
  },

  // ---------------------------------------------------------------------------
  // Safety: Block / Unblock / Report
  // ---------------------------------------------------------------------------
  async listBlocked() {
    if (DemoStore.isDemoSession()) return DemoStore.listBlocked();
    const fbUser = auth.currentUser;
    if (!fbUser) return [];
    const path = `users/${fbUser.uid}/blocked`;
    try {
      const snap = await getDocs(query(collection(db, path), where("blockerId", "==", fbUser.uid)));
      const userMap = await getUserMapByIds(snap.docs.map((d) => d.id));
      return snap.docs.map((d) => ({
        blocked_id: d.id,
        created_at: toIsoString(d.data().createdAt),
        blocked_user: userMap.get(d.id) || {
          id: d.id,
          first_name: "Blocked",
          last_name: "Account",
          username: "user",
        },
      }));
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.LIST, path);
      throw wrapFriendlyAuthError(err, "Could not load blocked users.");
    }
  },

  async blockUser(targetUid) {
    if (DemoStore.isDemoSession()) return DemoStore.blockUser(targetUid);
    const fbUser = auth.currentUser;
    if (!fbUser) throw makeError("Sign in required.", 401);
    const tUid = String(targetUid);
    const path = `users/${fbUser.uid}/blocked/${tUid}`;
    try {
      await setDoc(doc(db, path), {
        blockerId: fbUser.uid,
        blockedId: tUid,
        createdAt: serverTimestamp(),
      });
      return { ok: true };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.CREATE, path);
      throw wrapFriendlyAuthError(err, "Could not block user.");
    }
  },

  async unblockUser(targetUid) {
    if (DemoStore.isDemoSession()) return DemoStore.unblockUser(targetUid);
    const fbUser = auth.currentUser;
    if (!fbUser) throw makeError("Sign in required.", 401);
    const path = `users/${fbUser.uid}/blocked/${String(targetUid)}`;
    try {
      await deleteDoc(doc(db, path));
      return { ok: true };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.DELETE, path);
      throw wrapFriendlyAuthError(err, "Could not unblock user.");
    }
  },

  async reportUser({ reported_user_id, reason, description }) {
    if (DemoStore.isDemoSession()) return DemoStore.reportUser({ reported_user_id, reason, description });
    const fbUser = auth.currentUser;
    if (!fbUser) throw makeError("Sign in required.", 401);
    const reportId = generateId("rpt");
    const path = `reports/${reportId}`;
    try {
      await setDoc(doc(db, "reports", reportId), {
        reporterId: fbUser.uid,
        reportedUserId: String(reported_user_id),
        reason,
        description: description || null,
        status: "pending",
        createdAt: serverTimestamp(),
      });
      return { id: reportId };
    } catch (err) {
      if (isFirestorePermError(err)) handleFirestoreError(err, OperationType.CREATE, path);
      throw wrapFriendlyAuthError(err, "Could not submit report.");
    }
  },

  // ---------------------------------------------------------------------------
  // Firebase Storage Media Uploads (Profile Pictures & Event Covers)
  // ---------------------------------------------------------------------------
  _validateImageFile(file) {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
    if (!file) throw makeError("Please choose an image file.", 400);
    if (!allowed.includes(file.type)) {
      throw makeError("Unsupported image format. Choose a JPG, PNG, WebP, or GIF image.", 400);
    }
    if (file.size > 5 * 1024 * 1024) {
      throw makeError("Image must be smaller than 5 MB.", 400);
    }
  },

  uploadImage(folder, file, onProgress) {
    const fbUser = auth.currentUser;
    if (!fbUser) return Promise.reject(makeError("Sign in required to upload images.", 401));
    try {
      API._validateImageFile(file);
    } catch (err) {
      return Promise.reject(err);
    }

    const safeExt = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const filePath = `${folder}/${fbUser.uid}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
    const fileRef = storageRef(storage, filePath);
    const task = uploadBytesResumable(fileRef, file, { contentType: file.type });

    return new Promise((resolve, reject) => {
      task.on(
        "state_changed",
        (snap) => {
          const pct = snap.totalBytes ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0;
          if (typeof onProgress === "function") onProgress(pct);
        },
        (err) => {
          reject(wrapFriendlyAuthError(err, "Image upload failed. Please check your connection and try again."));
        },
        async () => {
          try {
            const url = await getDownloadURL(task.snapshot.ref);
            resolve(url);
          } catch (err) {
            reject(wrapFriendlyAuthError(err, "Uploaded file URL could not be retrieved."));
          }
        }
      );
    });
  },

  async uploadProfilePicture(file, onProgress) {
    return API.uploadImage("users", file, onProgress);
  },

  async uploadEventImage(file, onProgress) {
    return API.uploadImage("events", file, onProgress);
  },

  async resetDemoAccount() {
    const restored = DemoStore.reset();
    const fbUser = auth.currentUser;
    if (fbUser && fbUser.email?.toLowerCase() === CONFIG.DEMO_ACCOUNT.email) {
      const demo = CONFIG.DEMO_ACCOUNT;
      await updateDoc(doc(db, "users", fbUser.uid), {
        university: demo.university,
        city: demo.city,
        hobbies: demo.hobbies,
        interests: demo.interests,
        bio: demo.bio,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }
    return restored;
  },
};
