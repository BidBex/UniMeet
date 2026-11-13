"""
Database seeding script for UniMeet demo data.
Run explicitly via: `python -m app.seed` from `backend/`.
Never auto-executed in production startup.
"""
from datetime import datetime, timedelta, timezone

from app.config import get_settings
from app.database import SessionLocal, init_db
from app.models.event import Event, EventLike, EventParticipant, SoloStatus
from app.models.group import Group, GroupMember
from app.models.interest import Interest, UserInterest
from app.models.match import Match, UserLike
from app.models.message import Conversation, ConversationParticipant, Message
from app.models.user import User
from app.security.auth import hash_password

DEMO_PASSWORD = "DemoUser123!"


def seed_database() -> None:
    settings = get_settings()
    if settings.ENVIRONMENT.lower() == "production":
        raise RuntimeError("Refusing to insert demo accounts when ENVIRONMENT=production.")

    init_db()
    db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            print("Database already contains users. Skipping demo seed.")
            return

        now = datetime.now(timezone.utc)

        # 1. Interests catalog
        interests_data = [
            ("Indie Rock", "Music"),
            ("Electronic & Techno", "Music"),
            ("Jazz & Acoustic", "Music"),
            ("Festival Hopping", "Music"),
            ("Indie Cinema", "Film & Arts"),
            ("Contemporary Theatre", "Film & Arts"),
            ("Photography", "Film & Arts"),
            ("Board Games", "Gaming & Social"),
            ("Esports & LAN", "Gaming & Social"),
            ("Specialty Coffee", "Food & Lifestyle"),
            ("Street Food", "Food & Lifestyle"),
            ("Hiking & Cycling", "Sports & Outdoors"),
            ("Running Club", "Sports & Outdoors"),
            ("City Exploring", "Travel"),
            ("Hackathons & Tech", "Academic & Tech"),
            ("Language Exchange", "Academic & Tech"),
        ]
        interest_objs = {}
        for name, category in interests_data:
            obj = Interest(name=name, category=category)
            db.add(obj)
            db.flush()
            interest_objs[name] = obj

        # 2. 12 Demo Users (clearly labeled demo accounts)
        demo_users_data = [
            {
                "username": "elena_popescu",
                "email": "elena.demo@unimeet.edu",
                "first_name": "Elena",
                "last_name": "Popescu",
                "age": 21,
                "university": "Politehnica University of Timisoara",
                "city": "Timisoara",
                "bio": "[DEMO] Computer Science student at UPT. Always down for outdoor concerts in Piata Unirii or late-night board games.",
                "interests": ["Indie Rock", "Festival Hopping", "Board Games", "Specialty Coffee"],
                "is_moderator": True,
            },
            {
                "username": "andrei_ionescu",
                "email": "andrei.demo@unimeet.edu",
                "first_name": "Andrei",
                "last_name": "Ionescu",
                "age": 22,
                "university": "West University of Timisoara",
                "city": "Timisoara",
                "bio": "[DEMO] Film studies & photography nerd. Looking for people to hit indie cinema screenings and jazz bars with.",
                "interests": ["Indie Cinema", "Photography", "Jazz & Acoustic", "Specialty Coffee"],
            },
            {
                "username": "mara_stanciu",
                "email": "mara.demo@unimeet.edu",
                "first_name": "Mara",
                "last_name": "Stanciu",
                "age": 20,
                "university": "West University of Timisoara",
                "city": "Timisoara",
                "bio": "[DEMO] Psychology undergrad. Love festivals, street food markets, and spontaneous Bega riverside walks.",
                "interests": ["Festival Hopping", "Street Food", "City Exploring", "Indie Rock"],
            },
            {
                "username": "vlad_munteanu",
                "email": "vlad.demo@unimeet.edu",
                "first_name": "Vlad",
                "last_name": "Munteanu",
                "age": 23,
                "university": "Politehnica University of Timisoara",
                "city": "Timisoara",
                "bio": "[DEMO] Robotics & hackathon builder. Seeking squadmates for esports nights and electronic music gigs.",
                "interests": ["Hackathons & Tech", "Esports & LAN", "Electronic & Techno", "Board Games"],
            },
            {
                "username": "ioana_radulescu",
                "email": "ioana.demo@unimeet.edu",
                "first_name": "Ioana",
                "last_name": "Radulescu",
                "age": 21,
                "university": "Victor Babes University of Medicine",
                "city": "Timisoara",
                "bio": "[DEMO] Med student needing weekend culture breaks — theatre, acoustic nights, and Sunday running club.",
                "interests": ["Contemporary Theatre", "Jazz & Acoustic", "Running Club", "Specialty Coffee"],
            },
            {
                "username": "tudor_dumitru",
                "email": "tudor.demo@unimeet.edu",
                "first_name": "Tudor",
                "last_name": "Dumitru",
                "age": 22,
                "university": "Politehnica University of Timisoara",
                "city": "Timisoara",
                "bio": "[DEMO] Erasmus buddy & avid cyclist. Happy to meet international students for city walks and food tours.",
                "interests": ["Language Exchange", "Hiking & Cycling", "Street Food", "City Exploring"],
            },
            {
                "username": "sofia_marinescu",
                "email": "sofia.demo@unimeet.edu",
                "first_name": "Sofia",
                "last_name": "Marinescu",
                "age": 19,
                "university": "West University of Timisoara",
                "city": "Timisoara",
                "bio": "[DEMO] First-year design student. Always looking for company for galleries, rooftop cinema, and coffee.",
                "interests": ["Indie Cinema", "Photography", "Contemporary Theatre", "Specialty Coffee"],
            },
            {
                "username": "matei_georgescu",
                "email": "matei.demo@unimeet.edu",
                "first_name": "Matei",
                "last_name": "Georgescu",
                "age": 24,
                "university": "Babes-Bolyai University",
                "city": "Cluj-Napoca",
                "bio": "[DEMO] Master student visiting Timisoara often. Big fan of festivals, hiking, and indie gigs.",
                "interests": ["Indie Rock", "Festival Hopping", "Hiking & Cycling", "City Exploring"],
            },
            {
                "username": "daria_enache",
                "email": "daria.demo@unimeet.edu",
                "first_name": "Daria",
                "last_name": "Enache",
                "age": 21,
                "university": "University of Bucharest",
                "city": "Bucharest",
                "bio": "[DEMO] Literature & cinema lover exploring weekend festivals and student theatre exchanges.",
                "interests": ["Contemporary Theatre", "Indie Cinema", "Language Exchange", "Jazz & Acoustic"],
            },
            {
                "username": "alex_kovacs",
                "email": "alex.demo@unimeet.edu",
                "first_name": "Alex",
                "last_name": "Kovacs",
                "age": 20,
                "university": "Politehnica University of Timisoara",
                "city": "Timisoara",
                "bio": "[DEMO] Board game strategist and tabletop RPG host. Come join our weekly campus game night!",
                "interests": ["Board Games", "Esports & LAN", "Hackathons & Tech", "Street Food"],
            },
            {
                "username": "bianca_lazar",
                "email": "bianca.demo@unimeet.edu",
                "first_name": "Bianca",
                "last_name": "Lazar",
                "age": 22,
                "university": "West University of Timisoara",
                "city": "Timisoara",
                "bio": "[DEMO] Electronic music & sunset runner. Looking for friendly faces for weekend parties and festivals.",
                "interests": ["Electronic & Techno", "Festival Hopping", "Running Club", "Photography"],
            },
            {
                "username": "lucas_meyer",
                "email": "lucas.demo@unimeet.edu",
                "first_name": "Lucas",
                "last_name": "Meyer",
                "age": 23,
                "university": "Politehnica University of Timisoara",
                "city": "Timisoara",
                "bio": "[DEMO] Exchange student from Munich in Timisoara for the semester. Looking to try local food and concerts!",
                "interests": ["Language Exchange", "Indie Rock", "Street Food", "Hiking & Cycling"],
            },
        ]

        pw_hash = hash_password(DEMO_PASSWORD)
        users = []
        for idx, item in enumerate(demo_users_data):
            user = User(
                username=item["username"],
                email=item["email"],
                hashed_password=pw_hash,
                first_name=item["first_name"],
                last_name=item["last_name"],
                age=item["age"],
                university=item["university"],
                city=item["city"],
                bio=item["bio"],
                profile_picture=None,
                is_active=True,
                is_verified=False,
                is_moderator=item.get("is_moderator", False),
            )
            db.add(user)
            db.flush()
            for interest_name in item["interests"]:
                db.add(UserInterest(user_id=user.id, interest_id=interest_objs[interest_name].id))
            users.append(user)

        # 3. 12 Realistic Sample Events (Timișoara + other Romanian university cities)
        demo_events_data = [
            {
                "title": "Flight Festival Courtyard Warmup",
                "description": "[DEMO] Open-air indie and electronic sets right in the heart of Piata Unirii. Great spot to meet fellow students before the main weekend.",
                "category": "Festivals",
                "location": "Piata Unirii",
                "city": "Timisoara",
                "university": "Politehnica University of Timisoara",
                "days_ahead": 2,
                "duration_hours": 5,
                "image_url": "assets/images/event-festival.jpg",
                "creator": users[0],
                "max_participants": 45,
            },
            {
                "title": "Rooftop Indie Cinema: Sunset Screening",
                "description": "[DEMO] Cozy rooftop screening of an award-winning European indie film with beanbags, warm lights, and post-film discussion.",
                "category": "Cinema",
                "location": "Iulius Gardens Terrace",
                "city": "Timisoara",
                "university": "West University of Timisoara",
                "days_ahead": 3,
                "duration_hours": 3,
                "image_url": "assets/images/event-cinema.jpg",
                "creator": users[1],
                "max_participants": 25,
            },
            {
                "title": "Board Games & Specialty Coffee Evening",
                "description": "[DEMO] Catan, Codenames, Dixit, and flat whites near campus. Solo attendees extra welcome — we split into balanced tables!",
                "category": "Gaming",
                "location": "Cafeneaua Verde, Complex Studentesc",
                "city": "Timisoara",
                "university": "Politehnica University of Timisoara",
                "days_ahead": 1,
                "duration_hours": 3,
                "image_url": "assets/images/event-boardgames.jpg",
                "creator": users[9],
                "max_participants": 16,
            },
            {
                "title": "Indie Nights Live at The Courtyard",
                "description": "[DEMO] Three local student bands playing indie rock and synth-pop under courtyard string lights. Doors open at 19:30.",
                "category": "Concerts",
                "location": "Bastionul Theresia Courtyard",
                "city": "Timisoara",
                "university": "West University of Timisoara",
                "days_ahead": 4,
                "duration_hours": 4,
                "image_url": "assets/images/hero-concert.jpg",
                "creator": users[2],
                "max_participants": 60,
            },
            {
                "title": "Teatrul National Student Night",
                "description": "[DEMO] Contemporary student-discount theatre performance followed by a relaxed walk around Piata Victoriei.",
                "category": "Theatre",
                "location": "Teatrul National Mihai Eminescu",
                "city": "Timisoara",
                "university": "West University of Timisoara",
                "days_ahead": 5,
                "duration_hours": 3,
                "image_url": "assets/images/event-cinema.jpg",
                "creator": users[4],
                "max_participants": 20,
            },
            {
                "title": "Bega Riverside 5K Social Run",
                "description": "[DEMO] Easy-pace Saturday morning 5K along the Bega canal, finishing with pastries and iced lattes.",
                "category": "Sports",
                "location": "Parcul Rozelor",
                "city": "Timisoara",
                "university": "Victor Babes University of Medicine",
                "days_ahead": 6,
                "duration_hours": 2,
                "image_url": "assets/images/hero-concert.jpg",
                "creator": users[10],
                "max_participants": 30,
            },
            {
                "title": "Erasmus & Local Street Food Tour",
                "description": "[DEMO] Try langos, artisan burgers, and local craft sodas while practicing Romanian, English, and German.",
                "category": "Food",
                "location": "Piata Libertatii",
                "city": "Timisoara",
                "university": "Politehnica University of Timisoara",
                "days_ahead": 7,
                "duration_hours": 3,
                "image_url": "assets/images/event-boardgames.jpg",
                "creator": users[5],
                "max_participants": 18,
            },
            {
                "title": "Electronic Warehouse Afterhours",
                "description": "[DEMO] Melodic techno and house DJ showcase curated by local university music collectives.",
                "category": "Parties",
                "location": "Faber Cultural Center",
                "city": "Timisoara",
                "university": "Politehnica University of Timisoara",
                "days_ahead": 8,
                "duration_hours": 6,
                "image_url": "assets/images/event-festival.jpg",
                "creator": users[3],
                "max_participants": 80,
            },
            {
                "title": "Weekend Day Trip: Cheile Nerei Trail",
                "description": "[DEMO] Student carpool and train excursion to Cheile Nerei waterfalls. Bring hiking shoes and water!",
                "category": "Travel",
                "location": "Timisoara Nord Station Meeting Point",
                "city": "Timisoara",
                "university": "Politehnica University of Timisoara",
                "days_ahead": 10,
                "duration_hours": 9,
                "image_url": "assets/images/event-festival.jpg",
                "creator": users[11],
                "max_participants": 14,
            },
            {
                "title": "Acoustic Jazz & Vinyl Listening Session",
                "description": "[DEMO] Intimate Sunday evening jazz trio and vinyl swap at a cozy Timisoara lounge.",
                "category": "Concerts",
                "location": "Scart Loc Lejer",
                "city": "Timisoara",
                "university": "West University of Timisoara",
                "days_ahead": 9,
                "duration_hours": 3,
                "image_url": "assets/images/hero-concert.jpg",
                "creator": users[6],
                "max_participants": 22,
            },
            {
                "title": "Cluj Central Park Indie Picnic & Jam",
                "description": "[DEMO] Bring acoustic instruments, blankets, and snacks to Central Park for an open student jam session.",
                "category": "Other",
                "location": "Parcul Central Simion Barnutiu",
                "city": "Cluj-Napoca",
                "university": "Babes-Bolyai University",
                "days_ahead": 5,
                "duration_hours": 4,
                "image_url": "assets/images/event-festival.jpg",
                "creator": users[7],
                "max_participants": 35,
            },
            {
                "title": "Bucharest Old Town Student Theatre Showcase",
                "description": "[DEMO] Experimental short plays staged by university drama clubs followed by Q&A with the cast.",
                "category": "Theatre",
                "location": "Centrul Vechi Studio",
                "city": "Bucharest",
                "university": "University of Bucharest",
                "days_ahead": 11,
                "duration_hours": 3,
                "image_url": "assets/images/event-cinema.jpg",
                "creator": users[8],
                "max_participants": 40,
            },
        ]

        events = []
        for item in demo_events_data:
            start_dt = now + timedelta(days=item["days_ahead"], hours=18)
            end_dt = start_dt + timedelta(hours=item["duration_hours"])
            ev = Event(
                title=item["title"],
                description=item["description"],
                category=item["category"],
                location=item["location"],
                city=item["city"],
                university=item["university"],
                start_datetime=start_dt,
                end_datetime=end_dt,
                image_url=item["image_url"],
                creator_id=item["creator"].id,
                max_participants=item["max_participants"],
                is_active=True,
            )
            db.add(ev)
            db.flush()
            db.add(EventParticipant(event_id=ev.id, user_id=item["creator"].id, status="going"))
            events.append(ev)

        # Extra participations & likes
        extra_joins = [
            (events[0], users[1]),
            (events[0], users[2]),
            (events[0], users[11]),
            (events[1], users[0]),
            (events[1], users[6]),
            (events[2], users[0]),
            (events[2], users[3]),
            (events[3], users[0]),
            (events[3], users[11]),
        ]
        for ev, u in extra_joins:
            db.add(EventParticipant(event_id=ev.id, user_id=u.id, status="going"))
            db.add(EventLike(user_id=u.id, event_id=ev.id))

        # 4. Demo Groups + Group Conversations
        demo_groups = [
            {
                "name": "UPT Concert Crew",
                "description": "[DEMO] Friendly group of Politehnica & UVT students heading together to Piata Unirii festivals and live gigs.",
                "creator": users[0],
                "event": events[0],
                "max_members": 12,
                "is_public": True,
                "university": "Politehnica University of Timisoara",
                "location": "Timisoara",
                "interests_summary": "Indie Rock, Festival Hopping, Live Music",
                "members": [users[2], users[11]],
            },
            {
                "name": "Timisoara Cinephiles",
                "description": "[DEMO] Monthly rooftop & art-house film club with relaxed post-movie coffee chats.",
                "creator": users[1],
                "event": events[1],
                "max_members": 10,
                "is_public": True,
                "university": "West University of Timisoara",
                "location": "Timisoara",
                "interests_summary": "Indie Cinema, Photography, Specialty Coffee",
                "members": [users[6], users[4]],
            },
            {
                "name": "Complex Tabletop Squad",
                "description": "[DEMO] Weekly strategy board games & co-op nights in Complex Studentesc.",
                "creator": users[9],
                "event": events[2],
                "max_members": 8,
                "is_public": True,
                "university": "Politehnica University of Timisoara",
                "location": "Timisoara",
                "interests_summary": "Board Games, Esports, Street Food",
                "members": [users[0], users[3]],
            },
            {
                "name": "Erasmus Welcome Timisoara",
                "description": "[DEMO] International and local students teaming up for food tours, hiking trips, and concerts.",
                "creator": users[5],
                "event": events[6],
                "max_members": 20,
                "is_public": True,
                "university": "Politehnica University of Timisoara",
                "location": "Timisoara",
                "interests_summary": "Language Exchange, City Exploring, Travel",
                "members": [users[11], users[2]],
            },
        ]

        for gdata in demo_groups:
            grp = Group(
                name=gdata["name"],
                description=gdata["description"],
                creator_id=gdata["creator"].id,
                event_id=gdata["event"].id,
                max_members=gdata["max_members"],
                is_public=gdata["is_public"],
                university=gdata["university"],
                location=gdata["location"],
                interests_summary=gdata["interests_summary"],
            )
            db.add(grp)
            db.flush()
            db.add(GroupMember(group_id=grp.id, user_id=gdata["creator"].id, role="admin", status="active"))

            conv = Conversation(group_id=grp.id, title=grp.name)
            db.add(conv)
            db.flush()
            db.add(ConversationParticipant(conversation_id=conv.id, user_id=gdata["creator"].id))

            for m_user in gdata["members"]:
                db.add(GroupMember(group_id=grp.id, user_id=m_user.id, role="member", status="active"))
                db.add(ConversationParticipant(conversation_id=conv.id, user_id=m_user.id))

            db.add(
                Message(
                    conversation_id=conv.id,
                    sender_id=gdata["creator"].id,
                    content=f"Welcome to {grp.name}! Let's coordinate meeting time for {gdata['event'].title}.",
                    is_read=False,
                )
            )

        # 5. Demo Going Solo announcements
        solo_posts = [
            (
                users[11],
                events[3],
                "Just arrived in Timisoara for Erasmus and really want to catch Indie Nights at Bastion — anyone want to meet at 19:15 by the fountain?",
                72,
            ),
            (
                users[4],
                events[1],
                "Free after hospital rotations on Thursday and would love company for the rooftop film screening!",
                48,
            ),
            (
                users[6],
                events[2],
                "Never played Catan before but keen to learn over coffee if a table has an open spot.",
                36,
            ),
        ]
        for u, ev, msg, hrs in solo_posts:
            db.add(
                SoloStatus(
                    user_id=u.id,
                    event_id=ev.id,
                    message=msg,
                    status="active",
                    expires_at=now + timedelta(hours=hrs),
                )
            )

        # 6. Demo mutual match & direct chat between Elena (users[0]) and Mara (users[2])
        db.add(UserLike(sender_id=users[0].id, receiver_id=users[2].id, event_id=events[0].id))
        db.add(UserLike(sender_id=users[2].id, receiver_id=users[0].id, event_id=events[0].id))
        demo_match = Match(user1_id=users[0].id, user2_id=users[2].id, event_id=events[0].id, status="active")
        db.add(demo_match)
        db.flush()

        direct_conv = Conversation(match_id=demo_match.id, title=None)
        db.add(direct_conv)
        db.flush()
        db.add(ConversationParticipant(conversation_id=direct_conv.id, user_id=users[0].id))
        db.add(ConversationParticipant(conversation_id=direct_conv.id, user_id=users[2].id))
        db.add(
            Message(
                conversation_id=direct_conv.id,
                sender_id=users[2].id,
                content="Hey Elena! Saw we matched for Flight Festival Warmup — meeting at Piata Unirii around 18:30?",
                is_read=False,
            )
        )

        db.commit()
        print("Seeded 12 demo users, 16 interests, 12 events, 4 groups, 3 Going Solo posts, and 1 sample match.")
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
