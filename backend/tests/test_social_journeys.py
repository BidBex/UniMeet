from datetime import datetime, timedelta, timezone

from app.models.event import SoloStatus
from app.models.user import User
from tests.test_auth_and_users import register_user


def _future_iso(days=2):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def test_journey_a_and_d_matching_compatibility_and_websocket_chat(client):
    u1 = register_user(client, username="ana", email="ana@upt.ro", first_name="Ana").json()
    u2 = register_user(client, username="radu", email="radu@upt.ro", first_name="Radu").json()
    h1 = {"Authorization": f"Bearer {u1['access_token']}"}
    h2 = {"Authorization": f"Bearer {u2['access_token']}"}

    # Both select shared interests
    avail = client.get("/api/interests").json()
    shared_ids = [avail[0]["id"], avail[1]["id"]]
    client.put("/api/users/interests", headers=h1, json={"interest_ids": shared_ids})
    client.put("/api/users/interests", headers=h2, json={"interest_ids": shared_ids})

    # Compatibility check (Journey D)
    compat = client.get(f"/api/users/{u2['user']['id']}/compatibility", headers=h1)
    assert compat.status_code == 200
    assert compat.json()["compatibility"] >= 70
    assert len(compat.json()["shared_interests"]) == 2

    # Create event
    ev = client.post(
        "/api/events",
        headers=h1,
        json={
            "title": "Indie Concert Timisoara",
            "description": "Live student bands at Bastion courtyard.",
            "category": "Concerts",
            "location": "Bastion",
            "city": "Timisoara",
            "university": "Politehnica University of Timisoara",
            "start_datetime": _future_iso(2),
        },
    ).json()

    # Self-like rejected
    self_like = client.post(
        "/api/matches/like",
        headers=h1,
        json={"receiver_id": u1["user"]["id"], "event_id": ev["id"]},
    )
    assert self_like.status_code == 400

    # User 1 likes User 2 -> pending
    like1 = client.post(
        "/api/matches/like",
        headers=h1,
        json={"receiver_id": u2["user"]["id"], "event_id": ev["id"]},
    )
    assert like1.status_code == 200
    assert like1.json()["is_match"] is False

    # Duplicate like rejected
    dup = client.post(
        "/api/matches/like",
        headers=h1,
        json={"receiver_id": u2["user"]["id"], "event_id": ev["id"]},
    )
    assert dup.status_code == 409

    # User 2 likes User 1 -> reciprocal mutual match + conversation created
    like2 = client.post(
        "/api/matches/like",
        headers=h2,
        json={"receiver_id": u1["user"]["id"], "event_id": ev["id"]},
    )
    assert like2.status_code == 200
    assert like2.json()["is_match"] is True
    conv_id = like2.json()["match"]["conversation_id"]
    assert conv_id is not None

    # REST + WebSocket messaging
    ticket_res = client.post("/api/messages/ws-ticket", headers=h1)
    assert ticket_res.status_code == 200
    ticket = ticket_res.json()["ticket"]

    with client.websocket_connect(f"/api/ws/chat/{conv_id}?ticket={ticket}") as ws:
        ready = ws.receive_json()
        assert ready["type"] == "connection:ready"
        ws.send_json({"content": "Salut Radu! Ne vedem la Bastion?"})
        broadcast = ws.receive_json()
        assert broadcast["type"] == "message:new"
        assert broadcast["message"]["content"] == "Salut Radu! Ne vedem la Bastion?"

    history = client.get(f"/api/messages/conversations/{conv_id}", headers=h2)
    assert history.status_code == 200
    assert len(history.json()["messages"]) == 1
    msg_id = history.json()["messages"][0]["id"]

    read_res = client.put(f"/api/messages/{msg_id}/read", headers=h2)
    assert read_res.status_code == 200
    assert read_res.json()["is_read"] is True

    # Outsider cannot delete message
    u3 = register_user(client, username="outsider", email="out@upt.ro").json()
    h3 = {"Authorization": f"Bearer {u3['access_token']}"}
    outsider_del = client.delete(f"/api/messages/{msg_id}", headers=h3)
    assert outsider_del.status_code == 403

    # Participant can delete message
    del_res = client.delete(f"/api/messages/{msg_id}", headers=h1)
    assert del_res.status_code == 200
    history_after = client.get(f"/api/messages/conversations/{conv_id}", headers=h2)
    assert history_after.status_code == 200
    assert history_after.json()["messages"] == []


def test_journey_b_going_solo_and_expiry(client, db_session):
    u1 = register_user(client, username="solo1", email="solo1@upt.ro").json()
    u2 = register_user(client, username="solo2", email="solo2@upt.ro").json()
    h1 = {"Authorization": f"Bearer {u1['access_token']}"}
    h2 = {"Authorization": f"Bearer {u2['access_token']}"}

    ev = client.post(
        "/api/events",
        headers=h1,
        json={
            "title": "Rooftop Cinema",
            "description": "Outdoor film night at Iulius Gardens.",
            "category": "Cinema",
            "location": "Iulius Gardens",
            "city": "Timisoara",
            "start_datetime": _future_iso(1),
        },
    ).json()

    solo_res = client.post(
        "/api/solo",
        headers=h1,
        json={"event_id": ev["id"], "message": "Anyone up for rooftop cinema?", "expires_hours": 24},
    )
    assert solo_res.status_code == 201
    solo_id = solo_res.json()["id"]

    # Insert an already-expired solo status and verify it is excluded from GET /api/solo
    expired = SoloStatus(
        user_id=u2["user"]["id"],
        event_id=ev["id"],
        message="Expired announcement",
        status="active",
        expires_at=datetime.now(timezone.utc) - timedelta(hours=2),
    )
    db_session.add(expired)
    db_session.commit()

    listed = client.get("/api/solo", headers=h2)
    assert listed.status_code == 200
    assert [s["id"] for s in listed.json()] == [solo_id]

    interest = client.post(
        f"/api/solo/{solo_id}/interest",
        headers=h2,
        json={"message": "I'd love to join you!"},
    )
    assert interest.status_code == 200
    assert interest.json()["conversation_id"] > 0


def test_journey_c_groups_and_capacity(client):
    u1 = register_user(client, username="grp_owner", email="g1@upt.ro").json()
    u2 = register_user(client, username="grp_member", email="g2@upt.ro").json()
    u3 = register_user(client, username="grp_extra", email="g3@upt.ro").json()
    h1 = {"Authorization": f"Bearer {u1['access_token']}"}
    h2 = {"Authorization": f"Bearer {u2['access_token']}"}
    h3 = {"Authorization": f"Bearer {u3['access_token']}"}

    grp = client.post(
        "/api/groups",
        headers=h1,
        json={
            "name": "Board Game Crew",
            "description": "Small group for Catan night.",
            "max_members": 2,
            "is_public": True,
        },
    )
    assert grp.status_code == 201
    gid = grp.json()["id"]
    conv_id = grp.json()["conversation_id"]

    join2 = client.post(f"/api/groups/{gid}/join", headers=h2)
    assert join2.status_code == 200
    assert join2.json()["member_count"] == 2

    dup = client.post(f"/api/groups/{gid}/join", headers=h2)
    assert dup.status_code == 409

    full = client.post(f"/api/groups/{gid}/join", headers=h3)
    assert full.status_code == 409

    # Group member can chat in group conversation
    msg = client.post(
        f"/api/messages/conversations/{conv_id}/messages",
        headers=h2,
        json={"content": "See you at Complex Studentesc!"},
    )
    assert msg.status_code == 201


def test_journey_e_blocking_reporting_and_community(client, db_session):
    u1 = register_user(client, username="mod_user", email="mod@upt.ro").json()
    u2 = register_user(client, username="other_user", email="other@upt.ro").json()
    h1 = {"Authorization": f"Bearer {u1['access_token']}"}
    h2 = {"Authorization": f"Bearer {u2['access_token']}"}

    # Community endpoints work
    comm = client.get("/api/community", headers=h1)
    assert comm.status_code == 200
    assert len(comm.json()["students"]) == 1

    # Block user2
    blk = client.post(f"/api/safety/block/{u2['user']['id']}", headers=h1)
    assert blk.status_code == 201

    # Blocked user disappears from discovery & community & cannot be liked
    disc = client.get("/api/users/discover", headers=h1)
    assert disc.status_code == 200
    assert disc.json() == []

    blocked_list = client.get("/api/safety/blocked", headers=h1)
    assert len(blocked_list.json()) == 1

    # Report user with valid & invalid reasons
    bad_report = client.post(
        "/api/safety/report",
        headers=h1,
        json={"reported_user_id": u2["user"]["id"], "reason": "made_up_reason"},
    )
    assert bad_report.status_code == 400

    good_report = client.post(
        "/api/safety/report",
        headers=h1,
        json={
            "reported_user_id": u2["user"]["id"],
            "reason": "harassment",
            "description": "Repeated unsolicited messages.",
        },
    )
    assert good_report.status_code == 201

    # Non-moderator cannot view reports
    forbidden_reports = client.get("/api/safety/reports", headers=h2)
    assert forbidden_reports.status_code == 403

    # Elevate user1 to moderator in DB and inspect report
    user1_row = db_session.query(User).filter(User.id == u1["user"]["id"]).first()
    user1_row.is_moderator = True
    db_session.commit()

    mod_reports = client.get("/api/safety/reports", headers=h1)
    assert mod_reports.status_code == 200
    assert len(mod_reports.json()) == 1
