def register_user(
    client,
    username="alice_upt",
    email="alice@upt.ro",
    password="Password123!",
    first_name="Alice",
    last_name="Pop",
    university="Politehnica University of Timisoara",
    city="Timisoara",
):
    res = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": email,
            "password": password,
            "first_name": first_name,
            "last_name": last_name,
            "university": university,
            "city": city,
        },
    )
    return res


def test_register_login_logout_and_me(client):
    reg = register_user(client)
    assert reg.status_code == 201
    data = reg.json()
    assert data["user"]["email"] == "alice@upt.ro"
    assert "hashed_password" not in data["user"]
    assert "unimeet_access_token" in reg.cookies

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "alice_upt"

    logout = client.post("/api/auth/logout")
    assert logout.status_code == 200

    # New client without cookies is unauthorized
    client.cookies.clear()
    unauth = client.get("/api/auth/me")
    assert unauth.status_code == 401

    login = client.post(
        "/api/auth/login",
        json={"identifier": "alice@upt.ro", "password": "Password123!"},
    )
    assert login.status_code == 200
    assert login.json()["user"]["username"] == "alice_upt"


def test_duplicate_registration_and_invalid_credentials(client):
    first = register_user(client)
    assert first.status_code == 201

    dup_email = register_user(client, username="alice2", email="alice@upt.ro")
    assert dup_email.status_code == 409

    dup_user = register_user(client, username="alice_upt", email="alice2@upt.ro")
    assert dup_user.status_code == 409

    bad_pw = client.post(
        "/api/auth/login",
        json={"identifier": "alice@upt.ro", "password": "WrongPassword9"},
    )
    assert bad_pw.status_code == 401


def test_profile_edit_interests_and_privacy(client):
    reg1 = register_user(client, username="user1", email="u1@upt.ro")
    token1 = reg1.json()["access_token"]
    u1_id = reg1.json()["user"]["id"]

    reg2 = register_user(client, username="user2", email="u2@upt.ro", first_name="Bogdan")
    token2 = reg2.json()["access_token"]

    upd = client.put(
        "/api/users/me",
        headers={"Authorization": f"Bearer {token1}"},
        json={
            "first_name": "Elena-Updated",
            "username": "user1_updated",
            "email": "u1_updated@upt.ro",
            "bio": "Love live music and cinema",
            "city": "Timisoara",
            "age": 21,
        },
    )
    assert upd.status_code == 200
    assert upd.json()["first_name"] == "Elena-Updated"
    assert upd.json()["username"] == "user1_updated"
    assert upd.json()["email"] == "u1_updated@upt.ro"
    assert upd.json()["bio"] == "Love live music and cinema"

    conflict = client.put(
        "/api/users/me",
        headers={"Authorization": f"Bearer {token1}"},
        json={"email": "u2@upt.ro"},
    )
    assert conflict.status_code == 409

    interests_res = client.get(
        "/api/users/interests",
        headers={"Authorization": f"Bearer {token1}"},
    )
    assert interests_res.status_code == 200
    avail_ids = [i["id"] for i in interests_res.json()["available_interests"][:2]]

    set_int = client.put(
        "/api/users/interests",
        headers={"Authorization": f"Bearer {token1}"},
        json={"interest_ids": avail_ids},
    )
    assert set_int.status_code == 200
    assert len(set_int.json()["selected_interests"]) == 2

    # Public profile must not leak private email or password hashes
    pub = client.get(
        f"/api/users/{u1_id}",
        headers={"Authorization": f"Bearer {token2}"},
    )
    assert pub.status_code == 200
    pub_json = pub.json()
    assert "email" not in pub_json
    assert "hashed_password" not in pub_json
