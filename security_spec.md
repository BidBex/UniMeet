# UniMeet2026 Firestore Security Specification

## 1. Data Invariants (Eight Pillars Compliance)

1. **Identity & PII Isolation (`users/{uid}` vs `users/{uid}/private/info`)**
   - A `users/{uid}` document can only be created or modified by `request.auth.uid == uid` (or an explicit document-backed admin in `admins/{uid}`).
   - Email addresses and private account PII are never stored on `users/{uid}` and reside solely in `users/{uid}/private/info`, which is readable and writable strictly by the owner (`uid == request.auth.uid`) or an admin.
   - `isVerified`, `isSample`, `uid`, and `createdAt` cannot be self-elevated or altered by regular users on update.
2. **Username Uniqueness (`usernames/{usernameKey}`)**
   - Normalized lowercase usernames map to `{ uid, username, createdAt }`. Creation requires `!exists(...)` and `incoming().uid == request.auth.uid`.
3. **Events & Atomic Attendance/Like Counters (`events/{eventId}`, `eventParticipants/{id}`, `eventLikes/{id}`)**
   - Creating an event requires `organizerId == request.auth.uid`, `participantCount == 1`, `likeCount == 0`, `isActive == true`, `createdAt == request.time`, and an atomic `eventParticipants/{eventId}__{uid}` document in the same batch (`existsAfter`).
   - Incrementing/decrementing `participantCount` or `likeCount` by non-organizers is restricted strictly to `+/- 1` and only when the corresponding deterministic join/like document is synchronously created or deleted in the same transaction/batch.
4. **Directional Likes & Reciprocal Matches (`userLikes/{id}`, `matches/{id}`)**
   - A user cannot like themselves (`receiverId != request.auth.uid`).
   - A `matches/{matchId}` document can only be created when `request.auth.uid in incoming().userIds`, `status == 'active'`, and both directional `userLikes` documents exist (`existsAfter` + `exists`).
   - Unmatching transitions `status` from `active` to `unmatched` and locks further state transitions once `unmatched` (terminal state lock).
5. **Groups & Private Approval Sync (`groups/{groupId}`, `groupMembers/{id}`)**
   - Creating a group requires `creatorId == request.auth.uid`, `memberCount == 1`, plus atomic creation of the admin's `groupMembers/{groupId}__{uid}` document and the linked `chats/{conversationId}` document.
6. **Master Gate Chat Security (`chats/{chatId}`, `chats/{chatId}/messages/{messageId}`)**
   - Only listed `participants` (capped `<= 100`) may read or update `chats/{chatId}` or read/create messages in `chats/{chatId}/messages/{messageId}`.
   - Unsending a message is restricted to the original `senderId` when `!existing().isUnsent`, updating only `isUnsent` and `content`.
   - Marking read or hiding for self only mutates `readBy` or `hiddenFor` via bounded array updates.
7. **Going Solo & Moderation Reports (`soloPosts/{soloId}`, `soloInterests/{id}`, `reports/{reportId}`)**
   - `soloPosts` require `userId == request.auth.uid` and an existing `events/{eventId}`.
   - `reports` enforce `reporterId == request.auth.uid`, `reportedUserId != request.auth.uid`, and initial `status == 'pending'`; only admins may transition `status` out of `'pending'`.
8. **Temporal Integrity & Path Variable Hardening**
   - Every single-document target path validates ID format (`^[a-zA-Z0-9_-]+$`, `<= 128/256`), every `is string` check is paired with `.size()`, every `list` check evaluates `resource.data`, and timestamps use `request.time`.

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Identity Spoofing on User Creation (`users/victim_uid`)**
   - Attacker (`uid: "attacker_1"`) tries to create `/users/victim_uid` or `/users/attacker_1` with `{ uid: "victim_uid", isVerified: true }`.
2. **Self-Assigned Privilege / Shadow Field (`users/attacker_1` update)**
   - Attacker tries to update own profile with `{ isVerified: true, role: "admin", updatedAt: request.time }`.
3. **PII Blanket / Cross-User Read (`users/victim_uid/private/info`)**
   - Attacker tries to `get` `/users/victim_uid/private/info` or `list` `/users/victim_uid/private`.
4. **Ghost Field Injection on Event Creation (`events/ev_bad`)**
   - Attacker includes `{ ..., featuredRank: 999 }` shadow field not in allowed key set.
5. **Participant Count Manipulation Without Join (`events/ev_1` update)**
   - Attacker updates `participantCount` to `500` without creating `/eventParticipants/ev_1__attacker_1` in the same batch.
6. **Self-Like / Identity Spoofing in `userLikes`**
   - Attacker creates `/userLikes/victim__attacker__ev_1` claiming `senderId: "victim"` or `receiverId: "attacker_1"`.
7. **Fake Unilateral Match Injection (`matches/attacker_1__victim__ev_1`)**
   - Attacker attempts to create a `matches` doc without the reciprocal `userLikes/victim__attacker_1__ev_1` document existing.
8. **Terminal State Re-opening on Unmatched Record (`matches/m_1`)**
   - Attacker updates a `matches` doc whose `status == "unmatched"` back to `status: "active"`.
9. **Unauthorized Chat Eavesdropping (`chats/dm_alice_bob/messages/msg_1`)**
   - Non-participant (`uid: "eve"`) attempts to `get` or `list` messages inside `chats/dm_alice_bob/messages`.
10. **Forging Another User's Message (`chats/dm_alice_eve/messages/msg_forged`)**
    - Participant `eve` attempts to create a message with `senderId: "alice"`.
11. **Backdated Timestamp Spoofing (`events/ev_spoof`)**
    - Attacker creates an event with `createdAt: "1999-01-01T00:00:00Z"` instead of `request.time`.
12. **Resource Poisoning / Oversized ID & String (`events/<150-char-id>` & 5KB bio)**
    - Attacker submits a document ID > 128 chars or containing `$`/`..` or a 5KB `bio` exceeding blueprint `maxLength`.
