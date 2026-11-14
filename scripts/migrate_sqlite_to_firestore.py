#!/usr/bin/env python3
"""
Repeatable, idempotent SQLite -> Firebase Auth & Cloud Firestore migration script for UniMeet2026.

Usage:
  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
  python3 scripts/migrate_sqlite_to_firestore.py --dry-run
  python3 scripts/migrate_sqlite_to_firestore.py --sqlite-path backend/unimeet.db

Notes:
  - Preserves SQLite database untouched as archive/backup.
  - Creates/updates Firebase Auth users with placeholder passwords for migrated accounts
    (users can sign in via reset-password or register new accounts).
  - Isolates user emails into users/{uid}/private/info and strips PII from users/{uid}.
  - Marks demo/seed entities with isSample=True and user-created entities with isSample=False.
  - Idempotent: re-running updates/merges deterministic document IDs without duplicating records.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = ROOT_DIR / "firebase-applet-config.json"
DEFAULT_SQLITE_PATH = ROOT_DIR / "backend" / "unimeet.db"


def parse_iso_dt(value: Any) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return datetime.now(timezone.utc)


def iso_str(value: Any) -> str:
    return parse_iso_dt(value).isoformat().replace("+00:00", "Z")


def sqlite_rows(conn: sqlite3.Connection, query: str) -> list[dict[str, Any]]:
    conn.row_factory = sqlite3.Row
    return [dict(row) for row in conn.execute(query).fetchall()]


def load_firebase_config(config_path: Path) -> dict[str, Any]:
    if not config_path.exists():
        raise FileNotFoundError(f"Firebase config not found at {config_path}")
    return json.loads(config_path.read_text(encoding="utf-8"))


def migrate(sqlite_path: Path, config_path: Path, dry_run: bool = False) -> dict[str, int]:
    if not sqlite_path.exists():
        raise FileNotFoundError(f"SQLite database not found at {sqlite_path}")

    fb_config = load_firebase_config(config_path)
    project_id = fb_config["projectId"]
    database_id = fb_config.get("firestoreDatabaseId") or "(default)"

    conn = sqlite3.connect(str(sqlite_path))
    interests_rows = sqlite_rows(conn, "SELECT * FROM interests")
    users_rows = sqlite_rows(conn, "SELECT * FROM users")
    user_interests_rows = sqlite_rows(conn, "SELECT * FROM user_interests")
    user_hobbies_rows = sqlite_rows(conn, "SELECT * FROM user_hobbies")
    events_rows = sqlite_rows(conn, "SELECT * FROM events")
    event_participants_rows = sqlite_rows(conn, "SELECT * FROM event_participants")
    event_likes_rows = sqlite_rows(conn, "SELECT * FROM event_likes")
    user_likes_rows = sqlite_rows(conn, "SELECT * FROM user_likes")
    matches_rows = sqlite_rows(conn, "SELECT * FROM matches")
    groups_rows = sqlite_rows(conn, "SELECT * FROM groups")
    group_members_rows = sqlite_rows(conn, "SELECT * FROM group_members")
    solo_rows = sqlite_rows(conn, "SELECT * FROM solo_statuses")
    solo_interest_rows = sqlite_rows(conn, "SELECT * FROM solo_interests")
    convs_rows = sqlite_rows(conn, "SELECT * FROM conversations")
    conv_participants_rows = sqlite_rows(conn, "SELECT * FROM conversation_participants")
    messages_rows = sqlite_rows(conn, "SELECT * FROM messages")
    msg_deletions_rows = sqlite_rows(conn, "SELECT * FROM message_deletions")
    blocks_rows = sqlite_rows(conn, "SELECT * FROM blocks")
    reports_rows = sqlite_rows(conn, "SELECT * FROM reports")
    conn.close()

    interest_by_id = {row["id"]: row for row in interests_rows}
    interests_by_user: dict[int, list[str]] = {}
    for link in user_interests_rows:
        item = interest_by_id.get(link["interest_id"])
        if item:
            interests_by_user.setdefault(link["user_id"], []).append(item["name"])

    hobbies_by_user: dict[int, list[str]] = {}
    for row in user_hobbies_rows:
        hobbies_by_user.setdefault(row["user_id"], []).append(row["name"])

    event_by_id = {row["id"]: row for row in events_rows}
    liked_cats_by_user: dict[int, list[str]] = {}
    event_like_count: dict[int, int] = {}
    for row in event_likes_rows:
        eid = row["event_id"]
        event_like_count[eid] = event_like_count.get(eid, 0) + 1
        ev = event_by_id.get(eid)
        if ev and ev.get("category"):
            cats = liked_cats_by_user.setdefault(row["user_id"], [])
            if ev["category"] not in cats:
                cats.append(ev["category"])

    event_participant_count: dict[int, int] = {}
    for row in event_participants_rows:
        eid = row["event_id"]
        event_participant_count[eid] = event_participant_count.get(eid, 0) + 1

    group_member_count: dict[int, int] = {}
    for row in group_members_rows:
        if row.get("status") == "active":
            gid = row["group_id"]
            group_member_count[gid] = group_member_count.get(gid, 0) + 1

    solo_interest_count: dict[int, int] = {}
    for row in solo_interest_rows:
        sid = row["solo_id"]
        solo_interest_count[sid] = solo_interest_count.get(sid, 0) + 1

    deletions_by_msg: dict[int, list[str]] = {}
    uid_map = {row["id"]: f"sqlite_user_{row['id']}" for row in users_rows}
    for row in msg_deletions_rows:
        uid = uid_map.get(row["user_id"])
        if uid:
            deletions_by_msg.setdefault(row["message_id"], []).append(uid)

    participants_by_conv: dict[int, list[str]] = {}
    for row in conv_participants_rows:
        uid = uid_map.get(row["user_id"])
        if uid:
            participants_by_conv.setdefault(row["conversation_id"], []).append(uid)

    summary = {
        "interests": len(interests_rows),
        "users": len(users_rows),
        "events": len(events_rows),
        "eventParticipants": len(event_participants_rows),
        "eventLikes": len(event_likes_rows),
        "userLikes": len(user_likes_rows),
        "matches": len(matches_rows),
        "groups": len(groups_rows),
        "groupMembers": len(group_members_rows),
        "chats": len(convs_rows),
        "messages": len(messages_rows),
        "soloPosts": len(solo_rows),
        "soloInterests": len(solo_interest_rows),
        "blocks": len(blocks_rows),
        "reports": len(reports_rows),
    }

    if dry_run:
        print(f"[DRY RUN] Target Firebase project={project_id} database={database_id}")
        print(json.dumps(summary, indent=2))
        return summary

    try:
        import firebase_admin
        from firebase_admin import auth as fb_auth, credentials, firestore
    except ImportError as exc:
        raise RuntimeError(
            "firebase-admin is required to run live migration: pip install firebase-admin"
        ) from exc

    if not firebase_admin._apps:
        cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if cred_path:
            firebase_admin.initialize_app(credentials.Certificate(cred_path), {"projectId": project_id})
        else:
            firebase_admin.initialize_app(options={"projectId": project_id})

    db = firestore.Client(project=project_id, database=database_id)

    def commit_docs(writes: list[tuple[Any, dict[str, Any]]]) -> None:
        for idx in range(0, len(writes), 400):
            batch = db.batch()
            for ref, data in writes[idx : idx + 400]:
                batch.set(ref, data, merge=True)
            batch.commit()

    writes: list[tuple[Any, dict[str, Any]]] = []

    # 1. Interests catalog
    for row in interests_rows:
        iid = f"interest_{row['id']}"
        writes.append(
            (
                db.collection("interests").document(iid),
                {"id": iid, "name": row["name"], "category": row["category"]},
            )
        )

    # 2. Users (Auth + Public Profile + Private PII + Username Reservation)
    user_by_id = {row["id"]: row for row in users_rows}
    for row in users_rows:
        uid = uid_map[row["id"]]
        is_sample = bool(row.get("demo_key"))
        display_name = f"{row['first_name']} {row['last_name']}".strip() or row["username"]

        try:
            fb_auth.get_user(uid)
        except fb_auth.UserNotFoundError:
            try:
                fb_auth.create_user(
                    uid=uid,
                    email=row["email"],
                    display_name=display_name,
                    email_verified=bool(row.get("is_verified")),
                )
            except Exception as auth_err:
                print(f"[WARN] Auth create skipped for {row['email']}: {auth_err}")

        created_dt = parse_iso_dt(row.get("created_at"))
        writes.append(
            (
                db.collection("users").document(uid),
                {
                    "uid": uid,
                    "username": row["username"],
                    "displayName": display_name,
                    "firstName": row["first_name"],
                    "lastName": row["last_name"],
                    "age": row.get("age"),
                    "profilePicture": row.get("profile_picture"),
                    "university": row.get("university"),
                    "city": row.get("city"),
                    "bio": row.get("bio"),
                    "interests": interests_by_user.get(row["id"], []),
                    "hobbies": hobbies_by_user.get(row["id"], []),
                    "likedCategories": liked_cats_by_user.get(row["id"], []),
                    "isActive": bool(row.get("is_active", 1)),
                    "isVerified": bool(row.get("is_verified", 0)),
                    "isSample": is_sample,
                    "demoKey": row.get("demo_key"),
                    "createdAt": created_dt,
                    "updatedAt": created_dt,
                },
            )
        )
        writes.append(
            (
                db.collection("users").document(uid).collection("private").document("info"),
                {
                    "uid": uid,
                    "email": row["email"],
                    "updatedAt": created_dt,
                },
            )
        )
        writes.append(
            (
                db.collection("usernames").document(row["username"].lower()),
                {
                    "uid": uid,
                    "username": row["username"],
                    "createdAt": created_dt,
                },
            )
        )

    # 3. Events
    event_id_map = {row["id"]: f"sqlite_event_{row['id']}" for row in events_rows}
    for row in events_rows:
        eid = event_id_map[row["id"]]
        org = user_by_id.get(row["creator_id"], {})
        org_uid = uid_map.get(row["creator_id"], "sqlite_user_1")
        org_name = f"{org.get('first_name', 'UniMeet')} {org.get('last_name', 'Host')}".strip()
        created_dt = parse_iso_dt(row.get("created_at"))
        start_iso = iso_str(row["start_datetime"])
        writes.append(
            (
                db.collection("events").document(eid),
                {
                    "eventId": eid,
                    "title": row["title"],
                    "description": row["description"],
                    "location": row["location"],
                    "city": row["city"],
                    "university": row.get("university"),
                    "date": start_iso[:10],
                    "startTime": start_iso,
                    "endTime": iso_str(row["end_datetime"]) if row.get("end_datetime") else None,
                    "category": row["category"],
                    "organizerId": org_uid,
                    "organizerName": org_name,
                    "organizerUniversity": org.get("university"),
                    "maximumParticipants": row.get("max_participants"),
                    "participantCount": event_participant_count.get(row["id"], 1),
                    "likeCount": event_like_count.get(row["id"], 0),
                    "imageUrl": row.get("image_url"),
                    "isActive": bool(row.get("is_active", 1)),
                    "isSample": bool(org.get("demo_key")),
                    "createdAt": created_dt,
                    "updatedAt": created_dt,
                },
            )
        )

    # 4. Event participants & likes
    for row in event_participants_rows:
        eid = event_id_map.get(row["event_id"])
        uid = uid_map.get(row["user_id"])
        if eid and uid:
            writes.append(
                (
                    db.collection("eventParticipants").document(f"{eid}__{uid}"),
                    {
                        "eventId": eid,
                        "userId": uid,
                        "joinedAt": parse_iso_dt(row.get("joined_at")),
                        "status": "going",
                    },
                )
            )

    for row in event_likes_rows:
        eid = event_id_map.get(row["event_id"])
        uid = uid_map.get(row["user_id"])
        if eid and uid:
            writes.append(
                (
                    db.collection("eventLikes").document(f"{eid}__{uid}"),
                    {
                        "eventId": eid,
                        "userId": uid,
                        "createdAt": parse_iso_dt(row.get("created_at")),
                    },
                )
            )

    # 5. User likes & matches
    for row in user_likes_rows:
        s_uid = uid_map.get(row["sender_id"])
        r_uid = uid_map.get(row["receiver_id"])
        eid = event_id_map.get(row["event_id"])
        if s_uid and r_uid and eid:
            writes.append(
                (
                    db.collection("userLikes").document(f"{s_uid}__{r_uid}__{eid}"),
                    {
                        "senderId": s_uid,
                        "receiverId": r_uid,
                        "eventId": eid,
                        "createdAt": parse_iso_dt(row.get("created_at")),
                    },
                )
            )

    match_conv_by_match_id = {c["match_id"]: f"sqlite_chat_{c['id']}" for c in convs_rows if c.get("match_id")}
    for row in matches_rows:
        u1 = uid_map.get(row["user1_id"])
        u2 = uid_map.get(row["user2_id"])
        eid = event_id_map.get(row["event_id"])
        ev = event_by_id.get(row["event_id"], {})
        if u1 and u2 and eid:
            min_u, max_u = sorted([u1, u2])
            mid = f"{min_u}__{max_u}__{eid}"
            created_dt = parse_iso_dt(row.get("created_at"))
            writes.append(
                (
                    db.collection("matches").document(mid),
                    {
                        "matchId": mid,
                        "userIds": [min_u, max_u],
                        "eventId": eid,
                        "eventTitle": ev.get("title", "UniMeet Outing"),
                        "compatibilityScore": 50,
                        "conversationId": match_conv_by_match_id.get(row["id"]),
                        "status": "unmatched" if row.get("status") == "unmatched" else "active",
                        "createdAt": created_dt,
                        "updatedAt": created_dt,
                    },
                )
            )

    # 6. Groups & members
    group_id_map = {row["id"]: f"sqlite_group_{row['id']}" for row in groups_rows}
    group_conv_by_gid = {c["group_id"]: f"sqlite_chat_{c['id']}" for c in convs_rows if c.get("group_id")}
    group_by_id = {row["id"]: row for row in groups_rows}
    for row in groups_rows:
        gid = group_id_map[row["id"]]
        creator_uid = uid_map.get(row["creator_id"], "sqlite_user_1")
        org = user_by_id.get(row["creator_id"], {})
        eid = event_id_map.get(row.get("event_id"))
        ev = event_by_id.get(row.get("event_id"), {})
        created_dt = parse_iso_dt(row.get("created_at"))
        writes.append(
            (
                db.collection("groups").document(gid),
                {
                    "groupId": gid,
                    "name": row["name"],
                    "description": row["description"],
                    "creatorId": creator_uid,
                    "eventId": eid,
                    "eventTitle": ev.get("title"),
                    "maxMembers": int(row.get("max_members") or 10),
                    "memberCount": group_member_count.get(row["id"], 1),
                    "isPublic": bool(row.get("is_public", 1)),
                    "university": row.get("university"),
                    "location": row.get("location"),
                    "interestsSummary": row.get("interests_summary"),
                    "conversationId": group_conv_by_gid.get(row["id"], f"grp_{gid}"),
                    "isSample": bool(org.get("demo_key")),
                    "createdAt": created_dt,
                    "updatedAt": created_dt,
                },
            )
        )

    for row in group_members_rows:
        gid = group_id_map.get(row["group_id"])
        uid = uid_map.get(row["user_id"])
        grp = group_by_id.get(row["group_id"], {})
        if gid and uid:
            writes.append(
                (
                    db.collection("groupMembers").document(f"{gid}__{uid}"),
                    {
                        "groupId": gid,
                        "userId": uid,
                        "groupCreatorId": uid_map.get(grp.get("creator_id")),
                        "role": "admin" if row.get("role") == "admin" else "member",
                        "status": "pending" if row.get("status") == "pending" else "active",
                        "joinedAt": parse_iso_dt(row.get("joined_at")),
                    },
                )
            )

    # 7. Chats & messages
    last_msg_by_conv: dict[int, dict[str, Any]] = {}
    for msg in messages_rows:
        cid = msg["conversation_id"]
        prev = last_msg_by_conv.get(cid)
        if not prev or msg["id"] > prev["id"]:
            last_msg_by_conv[cid] = msg

    conv_id_map = {row["id"]: f"sqlite_chat_{row['id']}" for row in convs_rows}
    for row in convs_rows:
        cid = conv_id_map[row["id"]]
        parts = participants_by_conv.get(row["id"], [])
        if not parts:
            continue
        last_msg = last_msg_by_conv.get(row["id"])
        created_dt = parse_iso_dt(row.get("created_at"))
        chat_type = "group" if row.get("group_id") else ("direct" if row.get("match_id") else "solo")
        writes.append(
            (
                db.collection("chats").document(cid),
                {
                    "chatId": cid,
                    "participants": parts,
                    "type": chat_type,
                    "groupId": group_id_map.get(row.get("group_id")),
                    "title": row.get("title") or "Conversation",
                    "lastMessage": (
                        "This message was unsent"
                        if last_msg and last_msg.get("is_unsent")
                        else (last_msg.get("content") if last_msg else None)
                    ),
                    "lastMessageAt": parse_iso_dt(last_msg.get("created_at")) if last_msg else None,
                    "lastMessageSenderId": uid_map.get(last_msg["sender_id"]) if last_msg else None,
                    "createdAt": created_dt,
                    "updatedAt": parse_iso_dt(last_msg.get("created_at")) if last_msg else created_dt,
                },
            )
        )

    for row in messages_rows:
        cid = conv_id_map.get(row["conversation_id"])
        sender_uid = uid_map.get(row["sender_id"])
        if not cid or not sender_uid:
            continue
        mid = f"sqlite_msg_{row['id']}"
        parts = participants_by_conv.get(row["conversation_id"], [sender_uid])
        read_by = parts if row.get("is_read") else [sender_uid]
        writes.append(
            (
                db.collection("chats").document(cid).collection("messages").document(mid),
                {
                    "messageId": mid,
                    "chatId": cid,
                    "senderId": sender_uid,
                    "content": "This message was unsent" if row.get("is_unsent") else row["content"],
                    "timestamp": parse_iso_dt(row.get("created_at")),
                    "readBy": read_by,
                    "isUnsent": bool(row.get("is_unsent")),
                    "hiddenFor": deletions_by_msg.get(row["id"], []),
                },
            )
        )

    # 8. Going Solo posts & interests
    solo_id_map = {row["id"]: f"sqlite_solo_{row['id']}" for row in solo_rows}
    solo_by_id = {row["id"]: row for row in solo_rows}
    for row in solo_rows:
        sid = solo_id_map[row["id"]]
        uid = uid_map.get(row["user_id"])
        eid = event_id_map.get(row["event_id"])
        ev = event_by_id.get(row["event_id"], {})
        author = user_by_id.get(row["user_id"], {})
        if not uid or not eid:
            continue
        created_dt = parse_iso_dt(row.get("created_at"))
        writes.append(
            (
                db.collection("soloPosts").document(sid),
                {
                    "soloId": sid,
                    "userId": uid,
                    "eventId": eid,
                    "eventTitle": ev.get("title", "Campus Outing"),
                    "eventCity": ev.get("city", "Timisoara"),
                    "eventStartTime": iso_str(ev.get("start_datetime")),
                    "message": row["message"],
                    "status": "active" if row.get("status") == "active" else "inactive",
                    "interestCount": solo_interest_count.get(row["id"], 0),
                    "isSample": bool(author.get("demo_key")),
                    "createdAt": created_dt,
                    "expiresAt": iso_str(row.get("expires_at")),
                    "updatedAt": created_dt,
                },
            )
        )

    for row in solo_interest_rows:
        sid = solo_id_map.get(row["solo_id"])
        uid = uid_map.get(row["user_id"])
        solo = solo_by_id.get(row["solo_id"], {})
        if sid and uid:
            writes.append(
                (
                    db.collection("soloInterests").document(f"{sid}__{uid}"),
                    {
                        "soloId": sid,
                        "userId": uid,
                        "soloOwnerId": uid_map.get(solo.get("user_id")),
                        "message": row.get("message"),
                        "createdAt": parse_iso_dt(row.get("created_at")),
                    },
                )
            )

    # 9. Blocks & safety reports
    for row in blocks_rows:
        b_uid = uid_map.get(row["blocker_id"])
        t_uid = uid_map.get(row["blocked_id"])
        if b_uid and t_uid:
            writes.append(
                (
                    db.collection("users").document(b_uid).collection("blocked").document(t_uid),
                    {
                        "blockerId": b_uid,
                        "blockedId": t_uid,
                        "createdAt": parse_iso_dt(row.get("created_at")),
                    },
                )
            )

    for row in reports_rows:
        rep_uid = uid_map.get(row["reporter_id"])
        tgt_uid = uid_map.get(row["reported_user_id"])
        if rep_uid and tgt_uid:
            writes.append(
                (
                    db.collection("reports").document(f"sqlite_report_{row['id']}"),
                    {
                        "reporterId": rep_uid,
                        "reportedUserId": tgt_uid,
                        "reason": row["reason"],
                        "description": row.get("description"),
                        "status": row.get("status") or "pending",
                        "createdAt": parse_iso_dt(row.get("created_at")),
                    },
                )
            )

    commit_docs(writes)
    print(f"Migrated {len(writes)} Firestore documents to {project_id}/{database_id}.")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate UniMeet SQLite data into Cloud Firestore.")
    parser.add_argument("--sqlite-path", type=Path, default=DEFAULT_SQLITE_PATH)
    parser.add_argument("--config-path", type=Path, default=DEFAULT_CONFIG_PATH)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    migrate(args.sqlite_path, args.config_path, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
