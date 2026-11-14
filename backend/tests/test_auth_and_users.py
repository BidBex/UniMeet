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


def test_reset_demo_account_defaults(client):
    # Register a non-demo user first -> reset-demo must reject
    custom = register_user(client, username="custom_student", email="custom@upt.ro").json()
    custom_headers = {"Authorization": f"Bearer {custom['access_token']}"}
    bad_reset = client.post("/api/users/me/reset-demo", headers=custom_headers)
    assert bad_reset.status_code == 400

    # Register Elena's demo email/username, edit all fields & interests, then reset
    demo = register_user(
        client,
        username="elena_popescu",
        email="elena.demo@unimeet.edu",
        password="DemoUser123!",
        first_name="Temp",
        last_name="User",
    ).json()
    demo_headers = {"Authorization": f"Bearer {demo['access_token']}"}

    upd = client.put(
        "/api/users/me",
        headers=demo_headers,
        json={
            "username": "elena_renamed",
            "email": "renamed.demo@unimeet.edu",
            "first_name": "Changed",
            "last_name": "Name",
            "city": "Cluj-Napoca",
            "bio": "Custom edited bio",
        },
    )
    assert upd.status_code == 200
    assert upd.json()["username"] == "elena_renamed"

    restored = client.post("/api/users/me/reset-demo", headers=demo_headers)
    assert restored.status_code == 200
    data = restored.json()
    assert data["username"] == "elena_popescu"
    assert data["email"] == "elena.demo@unimeet.edu"
    assert data["first_name"] == "Elena"
    assert data["last_name"] == "Popescu"
    assert data["city"] == "Timisoara"
    assert any(i["name"] == "Indie Rock" for i in data["interests"])
    assert "Photography" in data["hobbies"]


def test_user_hobbies_crud_and_discovery(client):
    reg1 = register_user(client, username="hobby_user1", email="h1@upt.ro", first_name="Clara").json()
    headers1 = {"Authorization": f"Bearer {reg1['access_token']}"}
    u1_id = reg1["user"]["id"]

    reg2 = register_user(client, username="hobby_user2", email="h2@upt.ro", first_name="Dan").json()
    headers2 = {"Authorization": f"Bearer {reg2['access_token']}"}

    # Fetch suggested hobbies
    res_get = client.get("/api/users/hobbies", headers=headers1)
    assert res_get.status_code == 200
    assert res_get.json()["selected_hobbies"] == []
    assert "Bouldering" in res_get.json()["suggested_hobbies"]

    # Add suggested + custom hobbies (with duplicate casing & extra whitespace)
    res_put = client.put(
        "/api/users/hobbies",
        headers=headers1,
        json={"hobbies": ["  Bouldering ", "Ceramics", "bouldering", "Film Photography"]},
    )
    assert res_put.status_code == 200
    assert res_put.json()["selected_hobbies"] == ["Bouldering", "Ceramics", "Film Photography"]

    # Persists on /auth/me, public profile, and discover
    me = client.get("/api/auth/me", headers=headers1)
    assert me.status_code == 200
    assert me.json()["hobbies"] == ["Bouldering", "Ceramics", "Film Photography"]

    pub = client.get(f"/api/users/{u1_id}", headers=headers2)
    assert pub.status_code == 200
    assert pub.json()["hobbies"] == ["Bouldering", "Ceramics", "Film Photography"]

    disc = client.get("/api/users/discover", headers=headers2)
    assert disc.status_code == 200
    clara_card = next((u for u in disc.json() if u["id"] == u1_id), None)
    assert clara_card is not None
    assert clara_card["hobbies"] == ["Bouldering", "Ceramics", "Film Photography"]

    # Edit & remove via PUT /users/me as well
    upd = client.put(
        "/api/users/me",
        headers=headers1,
        json={"hobbies": ["Wheel Pottery", "Bouldering"]},
    )
    assert upd.status_code == 200
    assert upd.json()["hobbies"] == ["Wheel Pottery", "Bouldering"]

    disc_after = client.get("/api/users/discover", headers=headers2)
    clara_after = next((u for u in disc_after.json() if u["id"] == u1_id), None)
    assert clara_after["hobbies"] == ["Wheel Pottery", "Bouldering"]


def test_forgot_and_reset_password_flow(client):
    register_user(client, username="reset_user", email="reset@upt.ro", password="Password123!")

    # Invalid email syntax rejected cleanly
    bad_email = client.post("/api/auth/forgot-password", json={"email": "not-an-email"})
    assert bad_email.status_code == 422

    # Unknown email returns generic response without issuing token
    unknown = client.post("/api/auth/forgot-password", json={"email": "nobody@upt.ro"})
    assert unknown.status_code == 200
    assert unknown.json()["reset_token"] is None

    # Valid email generates single-use reset token
    req = client.post("/api/auth/forgot-password", json={"email": "reset@upt.ro"})
    assert req.status_code == 200
    token = req.json()["reset_token"]
    assert token

    # Weak password rejected
    weak = client.post("/api/auth/reset-password", json={"token": token, "new_password": "weak"})
    assert weak.status_code == 422

    # Reset succeeds and updates password
    done = client.post("/api/auth/reset-password", json={"token": token, "new_password": "NewPassword456!"})
    assert done.status_code == 200

    # Reusing same token fails because password fingerprint changed
    reused = client.post("/api/auth/reset-password", json={"token": token, "new_password": "AnotherPassword7!"})
    assert reused.status_code == 400

    # Old password fails, new password succeeds
    old_login = client.post("/api/auth/login", json={"identifier": "reset@upt.ro", "password": "Password123!"})
    assert old_login.status_code == 401
    assert old_login.json()["detail"] == "Incorrect email or password."
    assert req.json()["reset_url"].startswith("reset-password.html?token=")
    new_login = client.post("/api/auth/login", json={"identifier": "reset@upt.ro", "password": "NewPassword456!"})
    assert new_login.status_code == 200


def test_reset_password_page_routes(client):
    res_clean = client.get("/reset-password")
    assert res_clean.status_code == 200
    assert "Reset your password" in res_clean.text

    res_html = client.get("/reset-password.html")
    assert res_html.status_code == 200
    assert "Send Reset Link" in res_html.text

    reg_html = client.get("/register.html")
    assert reg_html.status_code == 200
    assert "Back to Sign In" not in reg_html.text


