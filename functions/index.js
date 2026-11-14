/**
 * UniMeet2026 Firebase Cloud Functions (Node 22 / v2 triggers)
 * Target Firestore database: ai-studio-unimeet-dcbd9c9e-96ae-49f0-bc6e-add8a5546578
 */
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

admin.initializeApp();

const DATABASE_ID = "ai-studio-unimeet-dcbd9c9e-96ae-49f0-bc6e-add8a5546578";
const REGION = "europe-west2";
const db = getFirestore(admin.app(), DATABASE_ID);

function computeCompatibility(userA, userB) {
  const interestsA = new Set((userA.interests || []).map((i) => String(i).toLowerCase()));
  const interestsB = new Set((userB.interests || []).map((i) => String(i).toLowerCase()));
  const sharedInterests = [...interestsA].filter((i) => interestsB.has(i));
  const unionInterests = new Set([...interestsA, ...interestsB]);

  const interestScore = unionInterests.size
    ? Math.min(60, Math.round((sharedInterests.length / unionInterests.size) * 90))
    : 0;

  const sameUniversity =
    Boolean(userA.university && userB.university) &&
    userA.university.trim().toLowerCase() === userB.university.trim().toLowerCase();
  const uniScore = sameUniversity ? 20 : 0;

  const sameCity =
    Boolean(userA.city && userB.city) &&
    userA.city.trim().toLowerCase() === userB.city.trim().toLowerCase();
  const cityScore = sameCity ? 10 : 0;

  const catsA = new Set((userA.likedCategories || []).map((c) => String(c).toLowerCase()));
  const catsB = new Set((userB.likedCategories || []).map((c) => String(c).toLowerCase()));
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
    shared_interests: sharedInterests,
    same_university: sameUniversity,
    same_city: sameCity,
    explanation: reasons.length ? `Matched on ${reasons.join(" · ")}.` : "Open student community match.",
  };
}

/**
 * Server-side reciprocal match generator when a userLikes document is created.
 * Ensures compatibility and deterministic chat creation even if client closes mid-flow.
 */
exports.onUserLikeCreated = onDocumentCreated(
  {
    document: "userLikes/{likeId}",
    database: DATABASE_ID,
    region: REGION,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const like = snap.data();
    const { senderId, receiverId, eventId } = like;
    if (!senderId || !receiverId || !eventId) return;

    const reciprocalId = `${receiverId}__${senderId}__${eventId}`;
    const reciprocalSnap = await db.collection("userLikes").doc(reciprocalId).get();
    if (!reciprocalSnap.exists) return;

    const [minUid, maxUid] = [senderId, receiverId].sort();
    const matchId = `${minUid}__${maxUid}__${eventId}`;
    const matchRef = db.collection("matches").doc(matchId);
    const chatId = `dm_${minUid}__${maxUid}`;
    const chatRef = db.collection("chats").doc(chatId);

    const [userASnap, userBSnap, eventSnap, existingMatch] = await Promise.all([
      db.collection("users").doc(minUid).get(),
      db.collection("users").doc(maxUid).get(),
      db.collection("events").doc(eventId).get(),
      matchRef.get(),
    ]);

    if (existingMatch.exists) return;

    const userA = userASnap.exists ? userASnap.data() : {};
    const userB = userBSnap.exists ? userBSnap.data() : {};
    const ev = eventSnap.exists ? eventSnap.data() : {};
    const compat = computeCompatibility(userA, userB);

    const batch = db.batch();
    const now = FieldValue.serverTimestamp();

    batch.set(
      chatRef,
      {
        chatId,
        participants: [minUid, maxUid],
        type: "direct",
        matchId,
        eventId,
        title: ev.title ? `Match · ${ev.title}` : "Direct Chat",
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    batch.set(matchRef, {
      matchId,
      userIds: [minUid, maxUid],
      eventId,
      eventTitle: ev.title || "UniMeet Outing",
      compatibilityScore: compat.compatibility,
      compatibilityDetails: compat,
      conversationId: chatId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await batch.commit();
  }
);

/**
 * Keeps parent chat thread metadata (lastMessage, lastMessageAt, updatedAt) synchronized
 * whenever a new message is written under chats/{chatId}/messages/{messageId}.
 */
exports.onChatMessageCreated = onDocumentCreated(
  {
    document: "chats/{chatId}/messages/{messageId}",
    database: DATABASE_ID,
    region: REGION,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const msg = snap.data();
    const { chatId } = event.params;

    await db.collection("chats").doc(chatId).set(
      {
        lastMessage: msg.isUnsent ? "This message was unsent" : msg.content,
        lastMessageAt: msg.timestamp || FieldValue.serverTimestamp(),
        lastMessageSenderId: msg.senderId || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
);

/**
 * Callable compatibility calculator for server-verified client queries.
 */
exports.computeMatchCompatibility = onCall({ region: REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const targetUid = String(request.data?.targetUid || "").trim();
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "targetUid is required.");
  }

  const [meSnap, otherSnap] = await Promise.all([
    db.collection("users").doc(request.auth.uid).get(),
    db.collection("users").doc(targetUid).get(),
  ]);

  if (!meSnap.exists || !otherSnap.exists) {
    throw new HttpsError("not-found", "User profile not found.");
  }

  return computeCompatibility(meSnap.data(), otherSnap.data());
});

/**
 * Privileged moderation action strictly verified via admins/{uid} document.
 */
exports.moderateReport = onCall({ region: REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const adminSnap = await db.collection("admins").doc(request.auth.uid).get();
  if (!adminSnap.exists) {
    throw new HttpsError("permission-denied", "Admin privileges required.");
  }

  const reportId = String(request.data?.reportId || "").trim();
  const nextStatus = String(request.data?.status || "").trim();
  if (!reportId || !["reviewed", "resolved", "dismissed"].includes(nextStatus)) {
    throw new HttpsError("invalid-argument", "Valid reportId and status required.");
  }

  await db.collection("reports").doc(reportId).update({
    status: nextStatus,
  });

  return { ok: true, reportId, status: nextStatus };
});
