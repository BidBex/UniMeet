from datetime import datetime, timedelta, timezone

from tests.test_auth_and_users import register_user


def _future_iso(days=3):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def test_event_crud_capacity_and_duplicate_likes(client):
    u1 = register_user(client, username="host1", email="host1@upt.ro").json()
    u2 = register_user(client, username="guest1", email="guest1@upt.ro").json()
    u3 = register_user(client, username="guest2", email="guest2@upt.ro").json()

    h1 = {"Authorization": f"Bearer {u1['access_token']}"}
    h2 = {"Authorization": f"Bearer {u2['access_token']}"}
    h3 = {"Authorization": f"Bearer {u3['access_token']}"}

    create_res = client.post(
        "/api/events",
        headers=h1,
        json={
            "title": "Piata Unirii Jazz Night",
            "description": "Evening jazz concert for Timisoara students.",
            "category": "Concerts",
            "location": "Piata Unirii",
            "city": "Timisoara",
            "university": "Politehnica University of Timisoara",
            "start_datetime": _future_iso(2),
            "max_participants": 2,
        },
    )
    assert create_res.status_code == 201
    event_id = create_res.json()["id"]
    assert create_res.json()["participant_count"] == 1  # creator joined automatically

    # Non-owner cannot edit
    forbidden = client.put(
        f"/api/events/{event_id}",
        headers=h2,
        json={"title": "Hijacked Event"},
    )
    assert forbidden.status_code == 403

    # Guest 1 joins (count = 2/2)
    join2 = client.post(f"/api/events/{event_id}/join", headers=h2)
    assert join2.status_code == 200
    assert join2.json()["participant_count"] == 2

    # Duplicate join blocked
    dup_join = client.post(f"/api/events/{event_id}/join", headers=h2)
    assert dup_join.status_code == 409

    # Capacity reached -> Guest 2 rejected
    cap_res = client.post(f"/api/events/{event_id}/join", headers=h3)
    assert cap_res.status_code == 409

    # Guest 1 leaves -> Guest 2 can join
    leave2 = client.delete(f"/api/events/{event_id}/leave", headers=h2)
    assert leave2.status_code == 200
    assert leave2.json()["participant_count"] == 1

    join3 = client.post(f"/api/events/{event_id}/join", headers=h3)
    assert join3.status_code == 200

    # Like & duplicate like protection
    like1 = client.post(f"/api/events/{event_id}/like", headers=h2)
    assert like1.status_code == 200
    assert like1.json()["like_count"] == 1

    like_dup = client.post(f"/api/events/{event_id}/like", headers=h2)
    assert like_dup.status_code == 409

    # Search and filter
    search = client.get("/api/events?q=Jazz&city=Timisoara&category=Concerts")
    assert search.status_code == 200
    assert search.json()["total"] == 1
