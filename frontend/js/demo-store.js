/**
 * Isolated, persistent Demo Environment Store for UniMeet2026 (demo@unimeet.app).
 * Persists all demo data and user mutations in localStorage under `unimeet_demo_env_v1`
 * without ever writing fake users/chats/posts into shared production Firestore collections.
 */
import { CONFIG, INTERESTS_CATALOG, SUGGESTED_HOBBIES } from "./config.js";
import { auth } from "./firebase-client.js";

const STORAGE_KEY = "unimeet_demo_env_v1";
const OFFLINE_DEMO_KEY = "unimeet_demo_offline_session";
const SCHEMA_VERSION = 1;
const ME_TOKEN = "__DEMO_ME__";

const INTEREST_BY_NAME = new Map(INTERESTS_CATALOG.map((i) => [i.name.toLowerCase(), i]));
const INTEREST_BY_ID = new Map(INTERESTS_CATALOG.map((i) => [i.id, i]));

const convListeners = new Set();
const msgListeners = new Map(); // chatId -> Set<callback>
const notifListeners = new Set();
const eventListeners = new Set();
const pendingReplyTimers = new Set();

function makeError(message, status = 400, code = "") {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function generateId(prefix) {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}_${rand}`;
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

function computeCompatibility(userA, userB) {
  const interestsA = new Set(
    (userA?.interest_names || userA?.interests?.map((i) => i.name || i) || []).map((x) =>
      String(x).toLowerCase()
    )
  );
  const interestsB = new Set(
    (userB?.interest_names || userB?.interests?.map((i) => i.name || i) || []).map((x) =>
      String(x).toLowerCase()
    )
  );
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
    shared_interests: sharedInterests.map((lower) => INTEREST_BY_NAME.get(lower)?.name || lower),
    same_university: sameUniversity,
    same_city: sameCity,
    explanation: reasons.length ? `Matched on ${reasons.join(" · ")}.` : "Open student community match.",
  };
}

function minsAgo(m) {
  return new Date(Date.now() - m * 60 * 1000).toISOString();
}

function hoursAgo(h) {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

function daysAgoAt(days, hour = 15, minute = 20) {
  const d = new Date(Date.now() - days * 86400 * 1000);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function hoursAhead(h) {
  return new Date(Date.now() + h * 3600 * 1000).toISOString();
}

function daysAheadAt(days, hour = 19, minute = 0) {
  const d = new Date(Date.now() + days * 86400 * 1000);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function createSeedState() {
  const demo = CONFIG.DEMO_ACCOUNT;

  const me = {
    id: ME_TOKEN,
    uid: ME_TOKEN,
    username: demo.username,
    first_name: demo.first_name,
    last_name: demo.last_name,
    display_name: `${demo.first_name} ${demo.last_name}`,
    email: demo.email,
    age: demo.age,
    profile_picture: demo.profile_picture,
    university: demo.university,
    city: demo.city,
    bio: demo.bio,
    interest_names: [...demo.interests],
    hobbies: [...demo.hobbies],
    liked_categories: [...demo.likedCategories],
    is_active: true,
    is_verified: true,
    email_verified: true,
    is_sample: false,
    created_at: daysAgoAt(45, 10, 0),
    updated_at: hoursAgo(2),
  };

  const students = [
    {
      id: "stu_01",
      username: "elena_ionescu",
      first_name: "Elena",
      last_name: "Ionescu",
      age: 21,
      profile_picture: "assets/images/avatars/u01.svg",
      university: "West University of Timisoara",
      city: "Timisoara",
      bio: "Literature & media student collecting vinyl records, organizing acoustic nights, and hunting for the best flat white in Unirii.",
      interests: ["Indie Music", "Jazz & Acoustic", "Coffee & City Walks", "Photography"],
      hobbies: ["Vinyl Collecting", "Specialty Coffee", "Photography"],
      liked_categories: ["Concert", "Festival", "Board Games"],
    },
    {
      id: "stu_02",
      username: "andrei_muresan",
      first_name: "Andrei",
      last_name: "Muresan",
      age: 22,
      profile_picture: "assets/images/avatars/u02.svg",
      university: "Politehnica University of Timisoara",
      city: "Timisoara",
      bio: "Automation & CS senior building side projects with TypeScript, bouldering at OneClimb, and always down for a weekend hackathon.",
      interests: ["Tech & Hackathons", "Bouldering & Hiking", "Board Games", "Indie Music"],
      hobbies: ["Bouldering", "3D Printing", "Board Games", "Chess"],
      liked_categories: ["Tech & Coding", "Campus Meetup", "Sports"],
    },
    {
      id: "stu_03",
      username: "mara_stoica",
      first_name: "Mara",
      last_name: "Stoica",
      age: 20,
      profile_picture: "assets/images/avatars/u03.svg",
      university: "West University of Timisoara",
      city: "Timisoara",
      bio: "Film studies & visual arts. At Cinema Victoria almost every Thursday — always happy to debate plot twists over tea.",
      interests: ["Indie Cinema", "Theatre & Drama", "Art Galleries", "Coffee & City Walks"],
      hobbies: ["Film Making", "Sketching", "Photography"],
      liked_categories: ["Cinema", "Theatre", "Art & Culture"],
    },
    {
      id: "stu_04",
      username: "radu_dumitrescu",
      first_name: "Radu",
      last_name: "Dumitrescu",
      age: 22,
      profile_picture: "assets/images/avatars/u04.svg",
      university: "Politehnica University of Timisoara",
      city: "Timisoara",
      bio: "Software engineering undergrad, tabletop strategist (Catan & Terraforming Mars), and amateur espresso nerd.",
      interests: ["Board Games", "Tech & Hackathons", "Coffee & City Walks", "Stand-up Comedy"],
      hobbies: ["Board Games", "Specialty Coffee", "Chess"],
      liked_categories: ["Board Games", "Campus Meetup", "Stand-up Comedy"],
    },
    {
      id: "stu_05",
      username: "sofia_rusu",
      first_name: "Sofia",
      last_name: "Rusu",
      age: 21,
      profile_picture: "assets/images/avatars/u05.svg",
      university: "Victor Babes University of Medicine",
      city: "Timisoara",
      bio: "Med student balancing anatomy exams with morning Bega runs, sunrise mountain hikes, and cozy study cafes.",
      interests: ["Running & Cycling", "Bouldering & Hiking", "Coffee & City Walks"],
      hobbies: ["Running", "Yoga", "Hiking", "Baking"],
      liked_categories: ["Sports", "Travel & Outdoors", "Campus Meetup"],
    },
    {
      id: "stu_06",
      username: "david_kovacs",
      first_name: "David",
      last_name: "Kovács",
      age: 20,
      profile_picture: "assets/images/avatars/u06.svg",
      university: "Politehnica University of Timisoara",
      city: "Timisoara",
      bio: "CS freshman organizing local Rocket League & Valorant student brackets. Bring your own controller for Mario Kart!",
      interests: ["Gaming & Esports", "Tech & Hackathons", "Board Games"],
      hobbies: ["Board Games", "Table Tennis", "3D Printing"],
      liked_categories: ["Gaming", "Tech & Coding", "Party"],
    },
    {
      id: "stu_07",
      username: "teodora_popa",
      first_name: "Teodora",
      last_name: "Popa",
      age: 21,
      profile_picture: "assets/images/avatars/u07.svg",
      university: "West University of Timisoara",
      city: "Timisoara",
      bio: "Graphic design student shooting 35mm film around Fabric & Elisabetin. Always looking for gallery companions.",
      interests: ["Photography", "Art Galleries", "Indie Cinema", "Indie Music"],
      hobbies: ["Photography", "Sketching", "Cycling"],
      liked_categories: ["Art & Culture", "Cinema", "Concert"],
    },
    {
      id: "stu_08",
      username: "vlad_georgescu",
      first_name: "Vlad",
      last_name: "Georgescu",
      age: 23,
      profile_picture: "assets/images/avatars/u08.svg",
      university: "Politehnica University of Timisoara",
      city: "Timisoara",
      bio: "Mechanical engineering master's student. You'll find me on the 3v3 campus basketball court or hitting the gym before 9 AM.",
      interests: ["Running & Cycling", "Campus Meetups", "Electronic & DJ Sets"],
      hobbies: ["Running", "Table Tennis", "Cooking"],
      liked_categories: ["Sports", "Party", "Festival"],
    },
    {
      id: "stu_09",
      username: "ioana_marinescu",
      first_name: "Ioana",
      last_name: "Marinescu",
      age: 21,
      profile_picture: "assets/images/avatars/u09.svg",
      university: "Victor Babes University of Medicine",
      city: "Timisoara",
      bio: "Organizing weekend river clean-ups, international food potlucks, and student volunteering drives across Timisoara.",
      interests: ["Street Food & Markets", "Campus Meetups", "Coffee & City Walks"],
      hobbies: ["Volunteering", "Cooking", "Baking"],
      liked_categories: ["Campus Meetup", "Festival"],
    },
    {
      id: "stu_10",
      username: "matei_lazar",
      first_name: "Matei",
      last_name: "Lazar",
      age: 22,
      profile_picture: "assets/images/avatars/u10.svg",
      university: "West University of Timisoara",
      city: "Timisoara",
      bio: "Jazz guitarist and regular at stand-up open mics. If there's live music or comedy on campus, count me in.",
      interests: ["Jazz & Acoustic", "Stand-up Comedy", "Indie Music", "Theatre & Drama"],
      hobbies: ["Guitar", "Vinyl Collecting", "Specialty Coffee"],
      liked_categories: ["Concert", "Stand-up Comedy", "Theatre"],
    },
    {
      id: "stu_11",
      username: "bianca_varga",
      first_name: "Bianca",
      last_name: "Varga",
      age: 21,
      profile_picture: "assets/images/avatars/u11.svg",
      university: "Politehnica University of Timisoara",
      city: "Timisoara",
      bio: "Architecture student curating rooftop sunset DJ playlists and summer festival carpools.",
      interests: ["Electronic & DJ Sets", "Festivals", "Art Galleries"],
      hobbies: ["Cycling", "Sketching", "Photography"],
      liked_categories: ["Party", "Festival", "Art & Culture"],
    },
    {
      id: "stu_12",
      username: "cristian_toma",
      first_name: "Cristian",
      last_name: "Toma",
      age: 23,
      profile_picture: "assets/images/avatars/u12.svg",
      university: "Banat University of Agricultural Sciences",
      city: "Timisoara",
      bio: "Weekend mountain guide for student hikes in Semenic, Retezat, and Cheile Nerei. Always packing extra trail snacks.",
      interests: ["Bouldering & Hiking", "Photography", "Running & Cycling"],
      hobbies: ["Hiking", "Gardening", "Photography"],
      liked_categories: ["Travel & Outdoors", "Sports"],
    },
    {
      id: "stu_13",
      username: "daria_neagu",
      first_name: "Daria",
      last_name: "Neagu",
      age: 20,
      profile_picture: "assets/images/avatars/u13.svg",
      university: "West University of Timisoara",
      city: "Timisoara",
      bio: "Psychology undergrad hosting silent reading mornings & pastry hops in Elisabetin.",
      interests: ["Coffee & City Walks", "Indie Cinema", "Street Food & Markets"],
      hobbies: ["Reading", "Baking", "Specialty Coffee"],
      liked_categories: ["Campus Meetup", "Cinema"],
    },
    {
      id: "stu_14",
      username: "stefan_barbu",
      first_name: "Stefan",
      last_name: "Barbu",
      age: 22,
      profile_picture: "assets/images/avatars/u14.svg",
      university: "Politehnica University of Timisoara",
      city: "Timisoara",
      bio: "Backend dev & Linux tinkerer. Looking for teammates for AI hackathons and blitz chess matches between lectures.",
      interests: ["Tech & Hackathons", "Gaming & Esports", "Board Games"],
      hobbies: ["Chess", "3D Printing", "Board Games"],
      liked_categories: ["Tech & Coding", "Gaming", "Board Games"],
    },
    {
      id: "stu_15",
      username: "ana_stan",
      first_name: "Ana-Maria",
      last_name: "Stan",
      age: 21,
      profile_picture: "assets/images/avatars/u15.svg",
      university: "West University of Timisoara",
      city: "Timisoara",
      bio: "Theatre club actor & indie film buff. Always up for last-minute National Theatre student rush tickets.",
      interests: ["Theatre & Drama", "Indie Cinema", "Art Galleries"],
      hobbies: ["Film Making", "Reading", "Photography"],
      liked_categories: ["Theatre", "Cinema", "Art & Culture"],
    },
    {
      id: "stu_16",
      username: "tudor_enescu",
      first_name: "Tudor",
      last_name: "Enescu",
      age: 22,
      profile_picture: "assets/images/avatars/u16.svg",
      university: "Victor Babes University of Medicine",
      city: "Timisoara",
      bio: "Training for a half-marathon along the Bega and looking for reliable morning gym & mobility buddies.",
      interests: ["Running & Cycling", "Bouldering & Hiking", "Campus Meetups"],
      hobbies: ["Running", "Cycling", "Cooking"],
      liked_categories: ["Sports", "Campus Meetup"],
    },
    {
      id: "stu_17",
      username: "karina_oltean",
      first_name: "Karina",
      last_name: "Oltean",
      age: 21,
      profile_picture: "assets/images/avatars/u17.svg",
      university: "West University of Timisoara",
      city: "Timisoara",
      bio: "Erasmus ambassador & city explorer! Help me discover hidden courtyards, street food markets, and acoustic gigs.",
      interests: ["Campus Meetups", "Coffee & City Walks", "Street Food & Markets", "Indie Music"],
      hobbies: ["Volunteering", "Photography", "Hiking"],
      liked_categories: ["Campus Meetup", "Concert", "Festival"],
    },
    {
      id: "stu_18",
      username: "mihai_balan",
      first_name: "Mihai",
      last_name: "Balan",
      age: 20,
      profile_picture: "assets/images/avatars/u18.svg",
      university: "Politehnica University of Timisoara",
      city: "Timisoara",
      bio: "Acoustic guitar player learning shoegaze & folk covers. Looking for jam buddies and chill board game nights.",
      interests: ["Indie Music", "Jazz & Acoustic", "Board Games"],
      hobbies: ["Guitar", "Board Games", "Vinyl Collecting"],
      liked_categories: ["Concert", "Board Games"],
    },
    {
      id: "stu_19",
      username: "roxana_dobre",
      first_name: "Roxana",
      last_name: "Dobre",
      age: 22,
      profile_picture: "assets/images/avatars/u19.svg",
      university: "West University of Timisoara",
      city: "Timisoara",
      bio: "Fine arts student organizing Sunday sketchbook picnics in Botanic Park and DIY pottery meetups.",
      interests: ["Art Galleries", "Coffee & City Walks", "Indie Cinema"],
      hobbies: ["Sketching", "Photography", "Cooking"],
      liked_categories: ["Art & Culture", "Campus Meetup"],
    },
    {
      id: "stu_20",
      username: "gabriel_nistor",
      first_name: "Gabriel",
      last_name: "Nistor",
      age: 23,
      profile_picture: "assets/images/avatars/u20.svg",
      university: "Banat University of Agricultural Sciences",
      city: "Timisoara",
      bio: "Landscape photographer & weekend road-trip planner. Next stop: Apuseni caves and sunrise ridges.",
      interests: ["Bouldering & Hiking", "Photography", "Festivals"],
      hobbies: ["Hiking", "Photography", "Bouldering"],
      liked_categories: ["Travel & Outdoors", "Festival"],
    },
  ].map((s) => ({
    ...s,
    uid: s.id,
    display_name: `${s.first_name} ${s.last_name}`,
    email: `${s.username}@student.unimeet.app`,
    interest_names: [...s.interests],
    interests: mapInterestsToUiObjects(s.interests),
    is_active: true,
    is_verified: true,
    is_sample: false,
    created_at: daysAgoAt(30, 12, 0),
    updated_at: hoursAgo(6),
  }));

  const events = [
    {
      id: "ev_01",
      title: "Timisoara Indie Acoustic Night",
      category: "Concert",
      location: "Bastion Theresia Courtyard",
      city: "Timisoara",
      university: "Politehnica University of Timisoara",
      description:
        "Warm evening acoustic sets by three local university bands under the Bastion arches. Meet 30 mins early by the courtyard fountain if you're coming solo.",
      image_url: "assets/images/hero-concert.jpg",
      creator_id: "stu_01",
      organizer_name: "Elena Ionescu",
      organizer_university: "West University of Timisoara",
      max_participants: 40,
      participant_ids: [ME_TOKEN, "stu_01", "stu_02", "stu_03", "stu_10", "stu_17", "stu_18"],
      liked_by: [ME_TOKEN, "stu_01", "stu_10", "stu_18", "stu_17"],
      start_datetime: daysAheadAt(2, 20, 0),
      is_sample: false,
    },
    {
      id: "ev_02",
      title: "Campus Rocket League & Valorant Cup",
      category: "Gaming",
      location: "UPT Electro Student Lounge (Room B12)",
      city: "Timisoara",
      university: "Politehnica University of Timisoara",
      description:
        "Friendly 2v2 Rocket League and 5v5 Valorant community brackets with Mario Kart side stations, pizza, and free sign-up for solo players.",
      image_url: "assets/images/event-gaming.jpg",
      creator_id: "stu_06",
      organizer_name: "David Kovács",
      organizer_university: "Politehnica University of Timisoara",
      max_participants: 32,
      participant_ids: [ME_TOKEN, "stu_06", "stu_02", "stu_14", "stu_04"],
      liked_by: ["stu_06", "stu_14", "stu_02"],
      start_datetime: hoursAhead(5),
      is_sample: false,
    },
    {
      id: "ev_03",
      title: "Full-Stack AI & TypeScript Mini-Hackathon",
      category: "Tech & Coding",
      location: "FabLab & UPT Innovation Hub",
      city: "Timisoara",
      university: "Politehnica University of Timisoara",
      description:
        "6-hour evening build sprint for student developers and designers. Team matching happens at kickoff — solo builders welcome!",
      image_url: "assets/images/event-hackathon.jpg",
      creator_id: "stu_02",
      organizer_name: "Andrei Muresan",
      organizer_university: "Politehnica University of Timisoara",
      max_participants: 50,
      participant_ids: [ME_TOKEN, "stu_02", "stu_04", "stu_14", "stu_06", "stu_11"],
      liked_by: [ME_TOKEN, "stu_02", "stu_14"],
      start_datetime: daysAheadAt(3, 17, 30),
      is_sample: false,
    },
    {
      id: "ev_04",
      title: "Sunset 3v3 Campus Basketball & Bega Run",
      category: "Sports",
      location: "Complex Sportiv UPT Courts",
      city: "Timisoara",
      university: "Politehnica University of Timisoara",
      description:
        "Casual rotating 3v3 pickup basketball games followed by an optional 4 km cooldown jog along the Bega canal. All skill levels!",
      image_url: "assets/images/event-sports.jpg",
      creator_id: "stu_08",
      organizer_name: "Vlad Georgescu",
      organizer_university: "Politehnica University of Timisoara",
      max_participants: 24,
      participant_ids: ["stu_08", "stu_05", "stu_16", "stu_02"],
      liked_by: ["stu_08", "stu_05", "stu_16"],
      start_datetime: hoursAhead(22),
      is_sample: false,
    },
    {
      id: "ev_05",
      title: "Morning Gym Partner & Mobility Session",
      category: "Sports",
      location: "SmartFit Complex Student Gym",
      city: "Timisoara",
      university: "Victor Babes University of Medicine",
      description:
        "Early-bird strength & mobility workout with fellow students so nobody skips leg day alone. Coffee stop right after!",
      image_url: "assets/images/event-sports.jpg",
      creator_id: "stu_16",
      organizer_name: "Tudor Enescu",
      organizer_university: "Victor Babes University of Medicine",
      max_participants: 12,
      participant_ids: ["stu_16", "stu_05", "stu_08"],
      liked_by: ["stu_16", "stu_05"],
      start_datetime: daysAheadAt(1, 9, 0),
      is_sample: false,
    },
    {
      id: "ev_06",
      title: "Rooftop Golden Hour DJ Set & Student Mixer",
      category: "Party",
      location: "Iulius Town Sky Terrace",
      city: "Timisoara",
      university: "West University of Timisoara",
      description:
        "House & nu-disco sunset sets with student DJs, mocktails, and relaxed rooftop conversations overlooking Timisoara.",
      image_url: "assets/images/event-rooftop.jpg",
      creator_id: "stu_11",
      organizer_name: "Bianca Varga",
      organizer_university: "Politehnica University of Timisoara",
      max_participants: 60,
      participant_ids: ["stu_11", "stu_01", "stu_08", "stu_17", "stu_10"],
      liked_by: [ME_TOKEN, "stu_11", "stu_01", "stu_17"],
      start_datetime: daysAheadAt(4, 19, 30),
      is_sample: false,
    },
    {
      id: "ev_07",
      title: "European Indie Film Night: Aftersun + Q&A",
      category: "Cinema",
      location: "Cinema Victoria",
      city: "Timisoara",
      university: "West University of Timisoara",
      description:
        "Curated indie screening in the heart of Unirii, followed by a 30-minute student discussion at the cafe next door.",
      image_url: "assets/images/event-cinema.jpg",
      creator_id: "stu_03",
      organizer_name: "Mara Stoica",
      organizer_university: "West University of Timisoara",
      max_participants: 28,
      participant_ids: [ME_TOKEN, "stu_03", "stu_07", "stu_13", "stu_15"],
      liked_by: ["stu_03", "stu_07", "stu_15"],
      start_datetime: daysAheadAt(5, 19, 0),
      is_sample: false,
    },
    {
      id: "ev_08",
      title: "Semenic Ridge Sunrise Hike & Carpool",
      category: "Travel & Outdoors",
      location: "Carpathian Trailhead (Departing from Piata Maria)",
      city: "Timisoara",
      university: "Banat University of Agricultural Sciences",
      description:
        "Day trip to Semenic mountain ridge! Shared carpool seats + easy-to-moderate 11 km scenic loop and thermos coffee at the summit.",
      image_url: "assets/images/event-travel.jpg",
      creator_id: "stu_12",
      organizer_name: "Cristian Toma",
      organizer_university: "Banat University of Agricultural Sciences",
      max_participants: 16,
      participant_ids: ["stu_12", "stu_05", "stu_20", "stu_17"],
      liked_by: ["stu_12", "stu_05", "stu_20"],
      start_datetime: daysAheadAt(8, 6, 30),
      is_sample: false,
    },
    {
      id: "ev_09",
      title: "Specialty Coffee & Catan Championship",
      category: "Board Games",
      location: "Student Complex Board Game Cafe",
      city: "Timisoara",
      university: "Politehnica University of Timisoara",
      description:
        "4 tables running Catan, Codenames, Azul, and Wingspan. Perfect low-pressure evening to make new friends.",
      image_url: "assets/images/event-boardgames.jpg",
      creator_id: "stu_04",
      organizer_name: "Radu Dumitrescu",
      organizer_university: "Politehnica University of Timisoara",
      max_participants: 20,
      participant_ids: ["stu_04", "stu_01", "stu_14", "stu_18", "stu_13"],
      liked_by: ["stu_04", "stu_01", "stu_18"],
      start_datetime: daysAheadAt(6, 18, 30),
      is_sample: false,
    },
    {
      id: "ev_10",
      title: "UVT Stand-up Comedy Open Mic Night",
      category: "Stand-up Comedy",
      location: "Casa Tineretului Studio",
      city: "Timisoara",
      university: "West University of Timisoara",
      description:
        "Student comics testing fresh 5-minute sets in English and Romanian. Grab a front-row seat with the comedy crew!",
      image_url: "assets/images/event-rooftop.jpg",
      creator_id: "stu_10",
      organizer_name: "Matei Lazar",
      organizer_university: "West University of Timisoara",
      max_participants: 45,
      participant_ids: ["stu_10", "stu_04", "stu_15", "stu_17"],
      liked_by: ["stu_10", "stu_04"],
      start_datetime: daysAheadAt(7, 20, 30),
      is_sample: false,
    },
    {
      id: "ev_11",
      title: "Flight Festival Pre-Party Gathering",
      category: "Festival",
      location: "Parcul Rozelor Stage",
      city: "Timisoara",
      university: "West University of Timisoara",
      description:
        "Meetup group heading together to the open-air festival pre-party — wristband meetup point & carpool coordination.",
      image_url: "assets/images/event-festival.jpg",
      creator_id: "stu_01",
      organizer_name: "Elena Ionescu",
      organizer_university: "West University of Timisoara",
      max_participants: 80,
      participant_ids: ["stu_01", "stu_11", "stu_17", "stu_20", "stu_03"],
      liked_by: ["stu_01", "stu_11", "stu_20"],
      start_datetime: daysAheadAt(11, 18, 0),
      is_sample: false,
    },
    {
      id: "ev_12",
      title: "Bega River Clean-up & Community Picnic",
      category: "Campus Meetup",
      location: "Parcul Botanic Lawn",
      city: "Timisoara",
      university: "Victor Babes University of Medicine",
      description:
        "90-minute riverside community clean-up followed by homemade lemonade, sandwiches, and lawn games with students from all 4 universities.",
      image_url: "assets/images/event-coffee.jpg",
      creator_id: "stu_09",
      organizer_name: "Ioana Marinescu",
      organizer_university: "Victor Babes University of Medicine",
      max_participants: 35,
      participant_ids: ["stu_09", "stu_17", "stu_13", "stu_19"],
      liked_by: ["stu_09", "stu_19"],
      start_datetime: daysAheadAt(9, 11, 0),
      is_sample: false,
    },
    {
      id: "ev_13",
      title: "Spring Semester Board Games Kickoff",
      category: "Board Games",
      location: "UPT Library Atrium",
      city: "Timisoara",
      university: "Politehnica University of Timisoara",
      description:
        "Past meetup where over 20 students teamed up for Codenames and Dixit after the first week of lectures.",
      image_url: "assets/images/event-boardgames.jpg",
      creator_id: "stu_04",
      organizer_name: "Radu Dumitrescu",
      organizer_university: "Politehnica University of Timisoara",
      max_participants: 24,
      participant_ids: [ME_TOKEN, "stu_04", "stu_02", "stu_06", "stu_18"],
      liked_by: [ME_TOKEN, "stu_04"],
      start_datetime: daysAgoAt(4, 18, 0),
      is_sample: false,
    },
    {
      id: "ev_14",
      title: "Unirii Courtyard Jazz & Espresso Jam",
      category: "Concert",
      location: "Piata Unirii Jazz Terrace",
      city: "Timisoara",
      university: "West University of Timisoara",
      description:
        "Past Sunday afternoon live quartet session — check the feed for photos and upcoming jam dates!",
      image_url: "assets/images/hero-concert.jpg",
      creator_id: "stu_10",
      organizer_name: "Matei Lazar",
      organizer_university: "West University of Timisoara",
      max_participants: 30,
      participant_ids: [ME_TOKEN, "stu_10", "stu_01", "stu_03", "stu_07"],
      liked_by: ["stu_10", "stu_01"],
      start_datetime: daysAgoAt(9, 17, 0),
      is_sample: false,
    },
  ].map((ev) => ({
    ...ev,
    date: ev.start_datetime.slice(0, 10),
    end_datetime: null,
    is_active: true,
    created_at: daysAgoAt(12, 10, 0),
  }));

  const groups = [
    {
      id: "grp_01",
      name: "Politehnica Esports & Couch Co-op",
      category: "Gaming",
      description: "Weekly Rocket League, Valorant, and Mario Kart nights in the student complex — open to casual and ranked players.",
      cover_image: "assets/images/event-gaming.jpg",
      creator_id: "stu_06",
      event_id: "ev_02",
      event_title: "Campus Rocket League & Valorant Cup",
      max_members: 60,
      member_ids: [ME_TOKEN, "stu_06", "stu_02", "stu_14", "stu_04", "stu_18"],
      member_count: 42,
      is_public: true,
      university: "Politehnica University of Timisoara",
      location: "Timisoara",
      interests_summary: "Gaming & Esports, Co-op, Tournaments",
      conversation_id: "conv_grp_01",
      membership_status: "active",
    },
    {
      id: "grp_02",
      name: "Timisoara Code & Build Hub",
      category: "Technology & Programming",
      description: "Student developers, UI designers, and AI builders sharing side projects, hackathon teams, and coffee coworking sessions.",
      cover_image: "assets/images/event-hackathon.jpg",
      creator_id: "stu_02",
      event_id: "ev_03",
      event_title: "Full-Stack AI & TypeScript Mini-Hackathon",
      max_members: 80,
      member_ids: [ME_TOKEN, "stu_02", "stu_14", "stu_04", "stu_06", "stu_11", "stu_07"],
      member_count: 54,
      is_public: true,
      university: "Politehnica University of Timisoara",
      location: "Timisoara",
      interests_summary: "TypeScript, AI, Hackathons, Open Source",
      conversation_id: "conv_05",
      membership_status: "active",
    },
    {
      id: "grp_03",
      name: "Bega Runners & 3v3 Hoops",
      category: "Sports & Fitness",
      description: "Evening pickup basketball at UPT courts, Bega canal 5K runs, and morning gym accountability partners.",
      cover_image: "assets/images/event-sports.jpg",
      creator_id: "stu_08",
      event_id: "ev_04",
      event_title: "Sunset 3v3 Campus Basketball & Bega Run",
      max_members: 50,
      member_ids: ["stu_08", "stu_05", "stu_16", "stu_02", "stu_12"],
      member_count: 31,
      is_public: true,
      university: "Politehnica University of Timisoara",
      location: "Timisoara",
      interests_summary: "Basketball, Running, Gym, Mobility",
      conversation_id: "conv_grp_03",
      membership_status: null,
    },
    {
      id: "grp_04",
      name: "UPT Indie & Acoustic Collective",
      category: "Music",
      description: "Concert buddies, vinyl swaps, guitar jam sessions, and local indie gig carpools across Timisoara.",
      cover_image: "assets/images/hero-concert.jpg",
      creator_id: "stu_01",
      event_id: "ev_01",
      event_title: "Timisoara Indie Acoustic Night",
      max_members: 40,
      member_ids: [ME_TOKEN, "stu_01", "stu_10", "stu_18", "stu_03", "stu_17"],
      member_count: 28,
      is_public: true,
      university: "West University of Timisoara",
      location: "Timisoara",
      interests_summary: "Indie Music, Acoustic, Concerts, Vinyl",
      conversation_id: "conv_03",
      membership_status: "active",
    },
    {
      id: "grp_05",
      name: "CS & Design Study Sessions",
      category: "University & Studying",
      description: "Pomodoro study blocks, exam prep notes, and specialty coffee table reservations during midterms and finals.",
      cover_image: "assets/images/event-coffee.jpg",
      creator_id: "stu_13",
      event_id: null,
      event_title: null,
      max_members: 75,
      member_ids: ["stu_13", "stu_02", "stu_05", "stu_07", "stu_14", "stu_09"],
      member_count: 47,
      is_public: true,
      university: "Politehnica University of Timisoara",
      location: "Timisoara",
      interests_summary: "Study Groups, Coffee, Exam Prep, Notes",
      conversation_id: "conv_grp_05",
      membership_status: null,
    },
    {
      id: "grp_06",
      name: "Cinema Victoria Film Club",
      category: "Movies & Entertainment",
      description: "Weekly European cinema screenings, festival retrospectives, and post-film espresso debates in Piata Unirii.",
      cover_image: "assets/images/event-cinema.jpg",
      creator_id: "stu_03",
      event_id: "ev_07",
      event_title: "European Indie Film Night: Aftersun + Q&A",
      max_members: 35,
      member_ids: [ME_TOKEN, "stu_03", "stu_07", "stu_15", "stu_13"],
      member_count: 23,
      is_public: true,
      university: "West University of Timisoara",
      location: "Timisoara",
      interests_summary: "Indie Cinema, Film Making, Theatre, Discussions",
      conversation_id: "conv_grp_06",
      membership_status: "active",
    },
    {
      id: "grp_07",
      name: "Carpathian Weekend Hikers",
      category: "Travel",
      description: "Budget-friendly student weekend trips to Semenic, Retezat, Cheile Nerei, and Apuseni — shared rides and sunrise trails.",
      cover_image: "assets/images/event-travel.jpg",
      creator_id: "stu_12",
      event_id: "ev_08",
      event_title: "Semenic Ridge Sunrise Hike & Carpool",
      max_members: 30,
      member_ids: [ME_TOKEN, "stu_12", "stu_05", "stu_20", "stu_17"],
      member_count: 19,
      is_public: true,
      university: "Banat University of Agricultural Sciences",
      location: "Timisoara",
      interests_summary: "Hiking, Mountain Travel, Carpools, Photography",
      conversation_id: "conv_08",
      membership_status: "active",
    },
    {
      id: "grp_08",
      name: "Erasmus & Campus Life Lounge",
      category: "General Discussions",
      description: "Open space for local and international students to ask campus questions, trade city tips, and organize casual hangs.",
      cover_image: "assets/images/event-rooftop.jpg",
      creator_id: "stu_17",
      event_id: null,
      event_title: null,
      max_members: 100,
      member_ids: ["stu_17", "stu_09", "stu_01", "stu_10", "stu_19"],
      member_count: 64,
      is_public: true,
      university: "West University of Timisoara",
      location: "Timisoara",
      interests_summary: "Campus Tips, Languages, City Guide, Friends",
      conversation_id: "conv_grp_08",
      membership_status: null,
    },
    {
      id: "grp_09",
      name: "Timisoara Board Game Guild",
      category: "Local Communities",
      description: "Strategy games, party games, and beginner-friendly cafe tables in Student Complex every Thursday night.",
      cover_image: "assets/images/event-boardgames.jpg",
      creator_id: "stu_04",
      event_id: "ev_09",
      event_title: "Specialty Coffee & Catan Championship",
      max_members: 40,
      member_ids: ["stu_04", "stu_01", "stu_14", "stu_18", "stu_13"],
      member_count: 26,
      is_public: true,
      university: "Politehnica University of Timisoara",
      location: "Timisoara",
      interests_summary: "Catan, Codenames, Chess, Local Cafes",
      conversation_id: "conv_grp_09",
      membership_status: "invited",
      invited_by: "stu_01",
    },
    {
      id: "grp_10",
      name: "Weekend Festival & Rooftop Crew",
      category: "Events & Social Activities",
      description: "Never go to a summer festival or rooftop DJ set alone — coordinate tickets, outfits, and safe rides home together.",
      cover_image: "assets/images/event-festival.jpg",
      creator_id: "stu_11",
      event_id: "ev_11",
      event_title: "Flight Festival Pre-Party Gathering",
      max_members: 60,
      member_ids: ["stu_11", "stu_01", "stu_17", "stu_20", "stu_08"],
      member_count: 38,
      is_public: true,
      university: "West University of Timisoara",
      location: "Timisoara",
      interests_summary: "Festivals, Rooftop Parties, Live Music, Going Solo",
      conversation_id: "conv_grp_10",
      membership_status: null,
    },
  ].map((g) => ({
    ...g,
    created_at: daysAgoAt(20, 14, 0),
  }));

  const conversations = [
    {
      id: "conv_01",
      type: "direct",
      title: "Elena Ionescu",
      participants: [ME_TOKEN, "stu_01"],
      event_id: "ev_01",
      messages: [
        { id: "m_01_1", sender_id: "stu_01", content: "Hey Alex! Saw you joined Timisoara Indie Acoustic Night.", created_at: daysAgoAt(1, 18, 12), read_by: [ME_TOKEN, "stu_01"] },
        { id: "m_01_2", sender_id: ME_TOKEN, content: "Yes! Really hyped for the second student band — are you going early?", created_at: daysAgoAt(1, 18, 25), read_by: [ME_TOKEN, "stu_01"] },
        { id: "m_01_3", sender_id: "stu_01", content: "For sure, a few of us are grabbing flat whites in Unirii at 19:15.", created_at: minsAgo(48), read_by: ["stu_01"] },
        { id: "m_01_4", sender_id: "stu_01", content: "Want us to save you a spot near the Bastion arches?", created_at: minsAgo(42), read_by: ["stu_01"] },
      ],
    },
    {
      id: "conv_02",
      type: "direct",
      title: "Andrei Muresan",
      participants: [ME_TOKEN, "stu_02"],
      event_id: "ev_03",
      messages: [
        { id: "m_02_1", sender_id: ME_TOKEN, content: "Hey Andrei, I checked out the FabLab hackathon page — looks super fun.", created_at: hoursAgo(6), read_by: [ME_TOKEN, "stu_02"] },
        { id: "m_02_2", sender_id: "stu_02", content: "Right?! Stefan and I are sketching a campus carpool map idea in TypeScript.", created_at: hoursAgo(4), read_by: [ME_TOKEN, "stu_02"] },
        { id: "m_02_3", sender_id: "stu_02", content: "Do you still need a team for Friday's mini-hackathon? We'd love you on frontend!", created_at: minsAgo(25), read_by: ["stu_02"] },
      ],
    },
    {
      id: "conv_03",
      type: "group",
      group_id: "grp_04",
      title: "UPT Indie & Acoustic Collective",
      participants: [ME_TOKEN, "stu_01", "stu_10", "stu_18", "stu_03", "stu_17"],
      messages: [
        { id: "m_03_1", sender_id: "stu_10", content: "Anyone bringing an acoustic guitar to the Bastion warm-up tomorrow?", created_at: daysAgoAt(1, 14, 10), read_by: [ME_TOKEN, "stu_01", "stu_10"] },
        { id: "m_03_2", sender_id: "stu_18", content: "I'll bring mine! Learned two new Arctic Monkeys acoustic arrangements.", created_at: daysAgoAt(1, 14, 34), read_by: [ME_TOKEN, "stu_18", "stu_01"] },
        { id: "m_03_3", sender_id: ME_TOKEN, content: "Awesome! I can bring my camera to grab a few photos of the set.", created_at: daysAgoAt(1, 15, 5), read_by: [ME_TOKEN, "stu_01", "stu_18"] },
        { id: "m_03_4", sender_id: "stu_17", content: "Two Erasmus friends want to tag along too — is it fine if they join the meetup spot?", created_at: hoursAgo(3), read_by: ["stu_17", "stu_01"] },
        { id: "m_03_5", sender_id: "stu_01", content: "100% yes! Meet by the Piata Unirii fountain at 19:15.", created_at: hoursAgo(2), read_by: ["stu_01"] },
        { id: "m_03_6", sender_id: "stu_10", content: "Perfect, see everyone there!", created_at: minsAgo(18), read_by: ["stu_10"] },
      ],
    },
    {
      id: "conv_04",
      type: "direct",
      title: "Mara Stoica",
      participants: [ME_TOKEN, "stu_03"],
      event_id: "ev_07",
      messages: [
        { id: "m_04_1", sender_id: "stu_03", content: "Alex! Seats for Aftersun at Cinema Victoria are almost gone — did you book Row G?", created_at: hoursAgo(7), read_by: [ME_TOKEN, "stu_03"] },
        { id: "m_04_2", sender_id: ME_TOKEN, content: "Just booked G7! Right next to your row.", created_at: hoursAgo(5), read_by: [ME_TOKEN, "stu_03"] },
        { id: "m_04_3", sender_id: "stu_03", content: "Nice! Let's grab tea afterwards to unpack that ending.", created_at: hoursAgo(4), read_by: [ME_TOKEN, "stu_03"] },
      ],
    },
    {
      id: "conv_05",
      type: "group",
      group_id: "grp_02",
      title: "Timisoara Code & Build Hub",
      participants: [ME_TOKEN, "stu_02", "stu_14", "stu_04", "stu_06", "stu_11", "stu_07"],
      messages: [
        { id: "m_05_1", sender_id: "stu_14", content: "Dropped the starter Vite + TS template in our pinned repo for Friday.", created_at: daysAgoAt(1, 11, 20), read_by: [ME_TOKEN, "stu_14", "stu_02"] },
        { id: "m_05_2", sender_id: "stu_11", content: "I can help with Figma wireframes and pitch slides if any team needs design!", created_at: daysAgoAt(1, 12, 15), read_by: [ME_TOKEN, "stu_11", "stu_02"] },
        { id: "m_05_3", sender_id: "stu_02", content: "Legend! Pizza order poll closes Thursday at noon — pepperoni vs veggie.", created_at: daysAgoAt(1, 16, 40), read_by: [ME_TOKEN, "stu_02"] },
      ],
    },
    {
      id: "conv_06",
      type: "direct",
      title: "David Kovács",
      participants: [ME_TOKEN, "stu_06"],
      event_id: "ev_02",
      messages: [
        { id: "m_06_1", sender_id: ME_TOKEN, content: "Hey David, what time do warm-ups start for the Rocket League 2v2 bracket?", created_at: daysAgoAt(1, 19, 15), read_by: [ME_TOKEN, "stu_06"] },
        { id: "m_06_2", sender_id: "stu_06", content: "Doors open 30 mins early in Room B12! Also bringing two extra Xbox controllers if you want one.", created_at: daysAgoAt(1, 20, 5), read_by: ["stu_06"] },
      ],
    },
    {
      id: "conv_07",
      type: "direct",
      title: "Sofia Rusu",
      participants: [ME_TOKEN, "stu_05"],
      messages: [
        { id: "m_07_1", sender_id: "stu_05", content: "Hey! Thanks for sharing your Semenic GPX trail map last week.", created_at: daysAgoAt(1, 9, 45), read_by: [ME_TOKEN, "stu_05"] },
        { id: "m_07_2", sender_id: ME_TOKEN, content: "No problem at all! Are you joining the sunrise hike next weekend?", created_at: daysAgoAt(1, 10, 12), read_by: [ME_TOKEN, "stu_05"] },
        { id: "m_07_3", sender_id: "stu_05", content: "Definitely! Already packed my windbreaker and thermos.", created_at: daysAgoAt(1, 10, 30), read_by: [ME_TOKEN, "stu_05"] },
      ],
    },
    {
      id: "conv_08",
      type: "group",
      group_id: "grp_07",
      title: "Carpathian Weekend Hikers",
      participants: [ME_TOKEN, "stu_12", "stu_05", "stu_20", "stu_17"],
      messages: [
        { id: "m_08_1", sender_id: "stu_12", content: "Weather forecast for Semenic Ridge looks crystal clear — 14°C and zero wind!", created_at: daysAgoAt(2, 17, 10), read_by: [ME_TOKEN, "stu_12", "stu_05"] },
        { id: "m_08_2", sender_id: "stu_20", content: "Bringing my 24-70mm lens for the sunrise shots. We still have 2 spots in my car from Piata Maria.", created_at: daysAgoAt(2, 18, 22), read_by: [ME_TOKEN, "stu_20", "stu_12"] },
        { id: "m_08_3", sender_id: ME_TOKEN, content: "Awesome, I'll bring hot tea and granola bars for the ridge break!", created_at: daysAgoAt(2, 19, 4), read_by: [ME_TOKEN, "stu_12", "stu_20"] },
      ],
    },
    {
      id: "conv_09",
      type: "direct",
      title: "Radu Dumitrescu",
      participants: [ME_TOKEN, "stu_04"],
      messages: [
        { id: "m_09_1", sender_id: "stu_04", content: "Yo Alex, tried that new single-origin Ethiopian pour-over spot near Student Complex — 10/10.", created_at: daysAgoAt(4, 13, 20), read_by: [ME_TOKEN, "stu_04"] },
        { id: "m_09_2", sender_id: ME_TOKEN, content: "Ooh let's hit it before Thursday's Catan tournament!", created_at: daysAgoAt(4, 13, 45), read_by: [ME_TOKEN, "stu_04"] },
      ],
    },
    {
      id: "conv_10",
      type: "direct",
      title: "Teodora Popa",
      participants: [ME_TOKEN, "stu_07"],
      messages: [
        { id: "m_10_1", sender_id: "stu_07", content: "Loved the photos you posted from the Unirii jazz jam! What camera were you shooting on?", created_at: daysAgoAt(6, 16, 10), read_by: [ME_TOKEN, "stu_07"] },
        { id: "m_10_2", sender_id: ME_TOKEN, content: "Thanks Teodora! Just a Fujifilm X-T30 with a 35mm prime.", created_at: daysAgoAt(6, 16, 40), read_by: [ME_TOKEN, "stu_07"] },
        { id: "m_10_3", sender_id: "stu_07", content: "Cleanest color tones! Let's do a photo walk around Fabric district soon.", created_at: daysAgoAt(6, 17, 2), read_by: [ME_TOKEN, "stu_07"] },
      ],
    },
    {
      id: "conv_11",
      type: "direct",
      title: "Vlad Georgescu",
      participants: [ME_TOKEN, "stu_08"],
      messages: [
        { id: "m_11_1", sender_id: "stu_08", content: "Need a 3rd player for Friday pickup hoops at UPT courts — you free around 6?", created_at: daysAgoAt(9, 15, 0), read_by: [ME_TOKEN, "stu_08"] },
        { id: "m_11_2", sender_id: ME_TOKEN, content: "Count me in next week, got a hackathon sprint this Friday!", created_at: daysAgoAt(9, 15, 35), read_by: [ME_TOKEN, "stu_08"] },
      ],
    },
  ];

  const matches = [
    {
      id: "match_01",
      other_user_id: "stu_01",
      event_id: "ev_01",
      event_title: "Timisoara Indie Acoustic Night",
      conversation_id: "conv_01",
      status: "active",
      created_at: daysAgoAt(2, 16, 20),
    },
    {
      id: "match_02",
      other_user_id: "stu_03",
      event_id: "ev_07",
      event_title: "European Indie Film Night: Aftersun + Q&A",
      conversation_id: "conv_04",
      status: "active",
      created_at: daysAgoAt(3, 19, 10),
    },
    {
      id: "match_03",
      other_user_id: "stu_02",
      event_id: "ev_03",
      event_title: "Full-Stack AI & TypeScript Mini-Hackathon",
      conversation_id: "conv_02",
      status: "active",
      created_at: daysAgoAt(4, 11, 45),
    },
  ];

  const soloPosts = [
    {
      id: "solo_01",
      user_id: "stu_17",
      event_id: "ev_06",
      message: "New Erasmus student in Timisoara! Heading solo to the Rooftop Golden Hour mixer — would love to meet a small group at the entrance at 19:15.",
      status: "active",
      interest_count: 4,
      expressed_by_me: false,
      created_at: hoursAgo(3),
      expires_at: hoursAhead(45),
    },
    {
      id: "solo_02",
      user_id: "stu_05",
      event_id: "ev_04",
      message: "Joining the Bega cooldown jog after 3v3 hoops tomorrow! Looking for 1–2 easy-pace running buddies (around 5:45/km).",
      status: "active",
      interest_count: 3,
      expressed_by_me: false,
      created_at: hoursAgo(7),
      expires_at: hoursAhead(40),
    },
    {
      id: "solo_03",
      user_id: "stu_10",
      event_id: "ev_10",
      message: "Going solo to the UVT Stand-up Open Mic! Happy to grab a table early at Casa Tineretului for anyone else coming alone.",
      status: "active",
      interest_count: 2,
      expressed_by_me: false,
      created_at: daysAgoAt(1, 13, 0),
      expires_at: hoursAhead(60),
    },
    {
      id: "solo_04",
      user_id: "stu_14",
      event_id: "ev_03",
      message: "Solo backend dev (Node/Python/Postgres) looking for 1 frontend & 1 designer for Friday's mini-hackathon!",
      status: "active",
      interest_count: 5,
      expressed_by_me: false,
      created_at: daysAgoAt(1, 17, 30),
      expires_at: hoursAhead(52),
    },
  ];

  const posts = [
    {
      id: "post_01",
      author_id: ME_TOKEN,
      content: "Just locked in my spot for Timisoara Indie Acoustic Night at Bastion! Anyone meeting in Unirii beforehand for specialty coffee?",
      image_url: "assets/images/hero-concert.jpg",
      group_id: "grp_04",
      event_id: "ev_01",
      tag: "Music",
      liked_by: ["stu_01", "stu_03", "stu_10", "stu_17", "stu_18", "stu_02", "stu_07"],
      comments: [
        { id: "c_01_1", author_id: "stu_01", content: "19:15 at the Unirii fountain! Saving you a flat white spot.", created_at: minsAgo(50) },
        { id: "c_01_2", author_id: "stu_18", content: "Count me in — bringing my acoustic guitar too!", created_at: minsAgo(35) },
      ],
      created_at: hoursAgo(2),
    },
    {
      id: "post_02",
      author_id: "stu_02",
      content: "Starter TypeScript + Vite repo is ready for Friday's Full-Stack AI Hackathon at FabLab! Drop your stack below if you're still looking for a squad.",
      image_url: "assets/images/event-hackathon.jpg",
      group_id: "grp_02",
      event_id: "ev_03",
      tag: "Tech & Coding",
      liked_by: [ME_TOKEN, "stu_14", "stu_04", "stu_06", "stu_11", "stu_07", "stu_01", "stu_17", "stu_08"],
      comments: [
        { id: "c_02_1", author_id: ME_TOKEN, content: "Super clean setup — excited to build the UI layer on Friday!", created_at: hoursAgo(3) },
        { id: "c_02_2", author_id: "stu_14", content: "Got the Postgres + API endpoints mocked and ready to go.", created_at: hoursAgo(2) },
        { id: "c_02_3", author_id: "stu_11", content: "I can jump in for the Figma components and demo deck!", created_at: minsAgo(55) },
      ],
      created_at: hoursAgo(5),
    },
    {
      id: "post_03",
      author_id: "stu_06",
      content: "Brackets are live for tonight's Campus Rocket League & Valorant Cup in Room B12! Extra controllers are charged — come hang out even if you just want to spectate.",
      image_url: "assets/images/event-gaming.jpg",
      group_id: "grp_01",
      event_id: "ev_02",
      tag: "Gaming",
      liked_by: [ME_TOKEN, "stu_02", "stu_14", "stu_04", "stu_18", "stu_08"],
      comments: [
        { id: "c_03_1", author_id: "stu_14", content: "Ready to defend last month's Mario Kart crown lol", created_at: hoursAgo(4) },
        { id: "c_03_2", author_id: "stu_06", content: "Bold claim before Rainbow Road!", created_at: hoursAgo(3) },
      ],
      created_at: hoursAgo(6),
    },
    {
      id: "post_04",
      author_id: "stu_12",
      content: "Throwback to last month's sunrise ridge hike — clear skies forecast for Semenic next Saturday! Two carpool seats still open from Piata Maria.",
      image_url: "assets/images/event-travel.jpg",
      group_id: "grp_07",
      event_id: "ev_08",
      tag: "Travel",
      liked_by: [ME_TOKEN, "stu_05", "stu_20", "stu_17", "stu_09", "stu_01", "stu_16", "stu_13", "stu_03", "stu_19", "stu_07"],
      comments: [
        { id: "c_04_1", author_id: "stu_05", content: "That sunrise glow is unreal. Can't wait for next week!", created_at: hoursAgo(7) },
        { id: "c_04_2", author_id: "stu_20", content: "Packing the wide-angle lens for this one.", created_at: hoursAgo(6) },
      ],
      created_at: hoursAgo(9),
    },
    {
      id: "post_05",
      author_id: "stu_04",
      content: "Unpopular opinion: Catan with 4 players + city knights expansion beats every video game on a rainy Thursday evening. Agree or disagree?",
      image_url: null,
      group_id: "grp_09",
      event_id: "ev_09",
      tag: "Board Games",
      liked_by: [ME_TOKEN, "stu_01", "stu_14", "stu_18", "stu_13"],
      comments: [
        { id: "c_05_1", author_id: "stu_18", content: "Hard agree as long as nobody monopolies wheat!", created_at: hoursAgo(10) },
      ],
      created_at: hoursAgo(12),
    },
    {
      id: "post_06",
      author_id: "stu_03",
      content: "Cinema Victoria just confirmed a post-screening Q&A for European Indie Film Night next week. Who else is grabbing Row G tickets?",
      image_url: "assets/images/event-cinema.jpg",
      group_id: "grp_06",
      event_id: "ev_07",
      tag: "Movies & TV",
      liked_by: [ME_TOKEN, "stu_07", "stu_15", "stu_13", "stu_01", "stu_19"],
      comments: [
        { id: "c_06_1", author_id: "stu_15", content: "Booked G5! Already bringing tissues for the final scene.", created_at: daysAgoAt(1, 19, 10) },
      ],
      created_at: daysAgoAt(1, 18, 30),
    },
    {
      id: "post_07",
      author_id: "stu_08",
      content: "Golden hour pickup hoops at the UPT courts hit different this week. Running another 3v3 rotation tomorrow at 18:00 — all levels welcome!",
      image_url: "assets/images/event-sports.jpg",
      group_id: "grp_03",
      event_id: "ev_04",
      tag: "Sports & Fitness",
      liked_by: ["stu_05", "stu_16", "stu_02", "stu_12", "stu_06"],
      comments: [
        { id: "c_07_1", author_id: "stu_16", content: "I'm in! Bringing two spare basketballs.", created_at: daysAgoAt(1, 16, 40) },
      ],
      created_at: daysAgoAt(1, 15, 20),
    },
    {
      id: "post_08",
      author_id: ME_TOKEN,
      content: "Found the quietest corner window table in Student Complex with fast Wi-Fi and great cortados. Ideal spot before algorithms lab.",
      image_url: "assets/images/event-coffee.jpg",
      group_id: "grp_05",
      event_id: null,
      tag: "Campus Life",
      liked_by: ["stu_13", "stu_02", "stu_05", "stu_04", "stu_01"],
      comments: [
        { id: "c_08_1", author_id: "stu_13", content: "Saving this spot for Tuesday's study session!", created_at: daysAgoAt(1, 12, 15) },
      ],
      created_at: daysAgoAt(1, 11, 10),
    },
    {
      id: "post_09",
      author_id: "stu_11",
      content: "Built a 90-minute sunset house & nu-disco playlist for Saturday's Rooftop Golden Hour mixer. Drop one track you want to hear under the string lights!",
      image_url: "assets/images/event-rooftop.jpg",
      group_id: "grp_10",
      event_id: "ev_06",
      tag: "Events",
      liked_by: [ME_TOKEN, "stu_01", "stu_17", "stu_08", "stu_10", "stu_20", "stu_07"],
      comments: [
        { id: "c_09_1", author_id: "stu_17", content: "Anything by Disclosure or Kaytranada please!", created_at: daysAgoAt(2, 20, 5) },
        { id: "c_09_2", author_id: "stu_01", content: "Parcels — Lightenup would fit the sunset vibe so well.", created_at: daysAgoAt(2, 20, 30) },
      ],
      created_at: daysAgoAt(2, 19, 0),
    },
    {
      id: "post_10",
      author_id: "stu_17",
      content: "First week in Timisoara as an Erasmus student and everyone in UniMeet groups has been so welcoming! Any must-try bakeries near Piata Victoriei?",
      image_url: null,
      group_id: "grp_08",
      event_id: null,
      tag: "Campus Life",
      liked_by: [ME_TOKEN, "stu_09", "stu_01", "stu_13", "stu_10", "stu_05", "stu_19", "stu_03"],
      comments: [
        { id: "c_10_1", author_id: "stu_13", content: "You have to try the cardamom buns near Elisabetin bridge!", created_at: daysAgoAt(2, 14, 10) },
        { id: "c_10_2", author_id: "stu_09", content: "Welcome to Timisoara! Come to our Bega clean-up & picnic next week too.", created_at: daysAgoAt(2, 15, 0) },
      ],
      created_at: daysAgoAt(2, 13, 20),
    },
    {
      id: "post_11",
      author_id: "stu_04",
      content: "Huge thanks to everyone who showed up for the Spring Semester Board Games Kickoff! Four full tables of Codenames and Azul all evening.",
      image_url: "assets/images/event-boardgames.jpg",
      group_id: "grp_09",
      event_id: "ev_13",
      tag: "Board Games",
      liked_by: [ME_TOKEN, "stu_02", "stu_06", "stu_18", "stu_01"],
      comments: [
        { id: "c_11_1", author_id: ME_TOKEN, content: "Still laughing about that 4-word Codenames clue haha", created_at: daysAgoAt(3, 18, 0) },
      ],
      created_at: daysAgoAt(3, 17, 15),
    },
    {
      id: "post_12",
      author_id: "stu_05",
      content: "Finished a crisp 6 km along the Bega before 8 AM lectures. Having a running buddy makes waking up 10x easier.",
      image_url: null,
      group_id: "grp_03",
      event_id: null,
      tag: "Sports & Fitness",
      liked_by: ["stu_16", "stu_08", "stu_12", "stu_09", ME_TOKEN],
      comments: [],
      created_at: daysAgoAt(3, 9, 30),
    },
    {
      id: "post_13",
      author_id: "stu_14",
      content: "Tip for CS students prepping for interviews: pair-programming one graph problem over coffee beats grinding 10 problems solo.",
      image_url: null,
      group_id: "grp_02",
      event_id: null,
      tag: "Tech & Coding",
      liked_by: [ME_TOKEN, "stu_02", "stu_04", "stu_06", "stu_13"],
      comments: [
        { id: "c_13_1", author_id: "stu_02", content: "100%! Let's host a whiteboard prep block next Wednesday.", created_at: daysAgoAt(4, 14, 15) },
      ],
      created_at: daysAgoAt(4, 12, 40),
    },
    {
      id: "post_14",
      author_id: "stu_01",
      content: "Just spun a fresh pressing of Khruangbin while planning next month's Flight Festival pre-party meetup. Who's got their festival pass already?",
      image_url: "assets/images/event-festival.jpg",
      group_id: "grp_10",
      event_id: "ev_11",
      tag: "Music",
      liked_by: ["stu_11", "stu_17", "stu_20", "stu_10", "stu_18", ME_TOKEN],
      comments: [
        { id: "c_14_1", author_id: "stu_11", content: "Got mine yesterday — our rooftop crew already has 12 people going!", created_at: daysAgoAt(4, 19, 10) },
      ],
      created_at: daysAgoAt(4, 18, 0),
    },
    {
      id: "post_15",
      author_id: ME_TOKEN,
      content: "Testing a clean React + Firebase prototype for campus event discovery today. Love how fast student builders move in Timisoara!",
      image_url: null,
      group_id: "grp_02",
      event_id: null,
      tag: "Tech & Coding",
      liked_by: ["stu_02", "stu_14", "stu_06", "stu_04"],
      comments: [
        { id: "c_15_1", author_id: "stu_02", content: "Ship it at Friday's hackathon!", created_at: daysAgoAt(5, 16, 20) },
      ],
      created_at: daysAgoAt(5, 15, 10),
    },
    {
      id: "post_16",
      author_id: "stu_19",
      content: "Hosting a chill Sunday sketchbook & watercolor picnic in Botanic Park next week — beginners completely welcome, extra brushes available.",
      image_url: null,
      group_id: "grp_08",
      event_id: null,
      tag: "Art & Culture",
      liked_by: ["stu_07", "stu_03", "stu_15", "stu_09", "stu_17"],
      comments: [
        { id: "c_16_1", author_id: "stu_07", content: "I'll bring my 35mm camera and some extra sketch paper!", created_at: daysAgoAt(5, 11, 30) },
      ],
      created_at: daysAgoAt(5, 10, 45),
    },
    {
      id: "post_17",
      author_id: "stu_10",
      content: "Writing 5 minutes of new stand-up material about student dorm kitchens for Thursday's UVT open mic — wish me luck!",
      image_url: null,
      group_id: "grp_04",
      event_id: "ev_10",
      tag: "Campus Life",
      liked_by: [ME_TOKEN, "stu_04", "stu_15", "stu_17", "stu_01"],
      comments: [
        { id: "c_17_1", author_id: "stu_04", content: "You've got instant material just from the shared fridge notes lol", created_at: daysAgoAt(6, 20, 15) },
      ],
      created_at: daysAgoAt(6, 19, 30),
    },
    {
      id: "post_18",
      author_id: "stu_13",
      content: "Midterm season reminder: hydrate, step outside for a 20-minute walk along the Bega, and join a study table so you don't stare at slides alone.",
      image_url: "assets/images/event-coffee.jpg",
      group_id: "grp_05",
      event_id: null,
      tag: "University",
      liked_by: [ME_TOKEN, "stu_05", "stu_09", "stu_02", "stu_07", "stu_17"],
      comments: [],
      created_at: daysAgoAt(7, 10, 0),
    },
  ];

  const notifications = [
    {
      id: "notif_01",
      type: "message",
      actor_id: "stu_01",
      title: "New message from Elena Ionescu",
      body: "\"Want us to save you a spot near the Bastion arches?\"",
      target_type: "conversation",
      target_id: "conv_01",
      is_read: false,
      created_at: minsAgo(42),
    },
    {
      id: "notif_02",
      type: "group_invite",
      actor_id: "stu_01",
      title: "Group invitation",
      body: "Elena Ionescu invited you to join Timisoara Board Game Guild.",
      target_type: "group",
      target_id: "grp_09",
      is_read: false,
      created_at: minsAgo(30),
    },
    {
      id: "notif_03",
      type: "message",
      actor_id: "stu_02",
      title: "New message from Andrei Muresan",
      body: "\"Do you still need a team for Friday's mini-hackathon?\"",
      target_type: "conversation",
      target_id: "conv_02",
      is_read: false,
      created_at: minsAgo(25),
    },
    {
      id: "notif_04",
      type: "comment_post",
      actor_id: "stu_01",
      title: "Elena Ionescu commented on your post",
      body: "\"19:15 at the Unirii fountain! Saving you a flat white spot.\"",
      target_type: "post",
      target_id: "post_01",
      is_read: false,
      created_at: minsAgo(50),
    },
    {
      id: "notif_05",
      type: "event_reminder",
      actor_id: "stu_06",
      title: "Happening today: Campus Rocket League & Valorant Cup",
      body: "Starts in 5 hours at UPT Electro Student Lounge (Room B12).",
      target_type: "event",
      target_id: "ev_02",
      is_read: false,
      created_at: hoursAgo(1),
    },
    {
      id: "notif_06",
      type: "like_post",
      actor_id: "stu_03",
      title: "Mara Stoica liked your post",
      body: "\"Just locked in my spot for Timisoara Indie Acoustic Night at Bastion!\"",
      target_type: "post",
      target_id: "post_01",
      is_read: true,
      created_at: hoursAgo(2),
    },
    {
      id: "notif_07",
      type: "follow",
      actor_id: "stu_07",
      title: "Teodora Popa started following you",
      body: "West University of Timisoara · 3 shared interests",
      target_type: "profile",
      target_id: "stu_07",
      is_read: true,
      created_at: hoursAgo(5),
    },
    {
      id: "notif_08",
      type: "follow",
      actor_id: "stu_10",
      title: "Matei Lazar started following you",
      body: "West University of Timisoara · Jazz & Indie Music",
      target_type: "profile",
      target_id: "stu_10",
      is_read: true,
      created_at: hoursAgo(8),
    },
    {
      id: "notif_09",
      type: "like_post",
      actor_id: "stu_14",
      title: "Stefan Barbu liked your post",
      body: "\"Testing a clean React + Firebase prototype for campus event discovery today.\"",
      target_type: "post",
      target_id: "post_15",
      is_read: true,
      created_at: daysAgoAt(1, 16, 0),
    },
    {
      id: "notif_10",
      type: "match",
      actor_id: "stu_01",
      title: "It's a match for Timisoara Indie Acoustic Night",
      body: "You and Elena Ionescu both want to go — start chatting!",
      target_type: "conversation",
      target_id: "conv_01",
      is_read: true,
      created_at: daysAgoAt(2, 16, 20),
    },
    {
      id: "notif_11",
      type: "event_reminder",
      actor_id: "stu_02",
      title: "Upcoming event: Full-Stack AI Mini-Hackathon",
      body: "In 3 days at FabLab & UPT Innovation Hub.",
      target_type: "event",
      target_id: "ev_03",
      is_read: true,
      created_at: daysAgoAt(2, 10, 0),
    },
    {
      id: "notif_12",
      type: "follow",
      actor_id: "stu_08",
      title: "Vlad Georgescu started following you",
      body: "Politehnica University of Timisoara · Sports & Running",
      target_type: "profile",
      target_id: "stu_08",
      is_read: true,
      created_at: daysAgoAt(3, 14, 20),
    },
  ];

  return {
    version: SCHEMA_VERSION,
    me,
    students,
    followingIds: ["stu_01", "stu_02", "stu_03", "stu_04", "stu_05", "stu_06", "stu_11", "stu_12", "stu_13"],
    followerIds: ["stu_01", "stu_02", "stu_03", "stu_04", "stu_05", "stu_06", "stu_07", "stu_08", "stu_09", "stu_10"],
    preLikedDemoUserIds: ["stu_07", "stu_10", "stu_14", "stu_17"],
    userLikesSent: [], // `${receiverId}__${eventId}`
    blockedIds: [],
    reports: [],
    events,
    groups,
    matches,
    soloPosts,
    posts,
    conversations,
    notifications,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === SCHEMA_VERSION && parsed.me && Array.isArray(parsed.students)) {
        return parsed;
      }
    }
  } catch {
    // Re-seed if storage corrupted
  }
  const seeded = createSeedState();
  saveState(seeded);
  return seeded;
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota warnings
  }
}

function getDemoUid() {
  const fbUser = auth.currentUser;
  if (fbUser?.email?.toLowerCase() === CONFIG.DEMO_ACCOUNT.email) {
    return fbUser.uid;
  }
  return "demo_alex_uid";
}

function normalizeIdForMe(id) {
  const meUid = getDemoUid();
  if (id === ME_TOKEN || id === meUid || id === "demo_alex_uid") return meUid;
  return id;
}

function isMeId(id) {
  return id === ME_TOKEN || id === getDemoUid() || id === "demo_alex_uid";
}

function formatMe(state) {
  const meUid = getDemoUid();
  const m = state.me;
  return {
    ...m,
    id: meUid,
    uid: meUid,
    interests: mapInterestsToUiObjects(m.interest_names),
    followers_count: state.followerIds.length,
    following_count: state.followingIds.length,
    posts_count: state.posts.filter((p) => isMeId(p.author_id)).length,
    groups_count: state.groups.filter((g) => g.membership_status === "active").length,
    events_count: state.events.filter((e) => (e.participant_ids || []).some(isMeId)).length,
  };
}

function formatUser(state, rawUser, includeCompat = true) {
  if (!rawUser) return null;
  if (isMeId(rawUser.id)) return formatMe(state);
  const meUi = formatMe(state);
  const blocked = new Set(state.blockedIds);
  const following = new Set(state.followingIds);
  const followers = new Set(state.followerIds);
  const out = {
    ...rawUser,
    interests: mapInterestsToUiObjects(rawUser.interest_names || rawUser.interests),
    is_following: following.has(rawUser.id),
    follows_me: followers.has(rawUser.id),
    is_blocked: blocked.has(rawUser.id),
    followers_count: 14 + (parseInt(rawUser.id.replace(/\D/g, ""), 10) || 1) * 3 + (following.has(rawUser.id) ? 1 : 0),
    following_count: 10 + ((parseInt(rawUser.id.replace(/\D/g, ""), 10) || 1) % 7) * 4,
  };
  if (includeCompat) {
    out.compatibility = computeCompatibility(meUi, out);
  }
  return out;
}

function getUserById(state, id, includeCompat = true) {
  if (isMeId(id)) return formatMe(state);
  const found = state.students.find((s) => s.id === id);
  return found ? formatUser(state, found, includeCompat) : null;
}

function formatEvent(state, ev) {
  const meUid = getDemoUid();
  const isJoined = (ev.participant_ids || []).some(isMeId);
  const isLiked = (ev.liked_by || []).some(isMeId);
  return {
    ...ev,
    creator_id: normalizeIdForMe(ev.creator_id),
    participant_count: (ev.participant_ids || []).length,
    like_count: (ev.liked_by || []).length,
    is_joined: isJoined,
    is_liked: isLiked,
    is_past: new Date(ev.start_datetime).getTime() < Date.now(),
    is_soon:
      new Date(ev.start_datetime).getTime() >= Date.now() &&
      new Date(ev.start_datetime).getTime() - Date.now() <= 48 * 3600 * 1000,
    me_uid: meUid,
  };
}

function formatGroup(state, grp) {
  const isMember = grp.membership_status === "active";
  return {
    ...grp,
    creator_id: normalizeIdForMe(grp.creator_id),
    is_member: isMember,
    member_count: grp.member_count,
  };
}

function formatConversation(state, conv) {
  const blocked = new Set(state.blockedIds);
  const meUid = getDemoUid();
  const visibleMsgs = (conv.messages || []).filter(
    (m) => !(m.hidden_for || []).some(isMeId) && !blocked.has(m.sender_id)
  );
  const lastMsg = visibleMsgs[visibleMsgs.length - 1] || null;
  const unreadCount = visibleMsgs.filter(
    (m) => !isMeId(m.sender_id) && !(m.read_by || []).some(isMeId)
  ).length;

  let otherUser = null;
  if (conv.type !== "group") {
    const otherId = (conv.participants || []).find((p) => !isMeId(p));
    if (!otherId || blocked.has(otherId)) return null;
    otherUser = getUserById(state, otherId, false);
  }

  const grp = conv.group_id ? state.groups.find((g) => g.id === conv.group_id) : null;
  return {
    id: conv.id,
    chatId: conv.id,
    type: conv.type,
    group_id: conv.group_id || null,
    group_creator_id: grp ? normalizeIdForMe(grp.creator_id) : null,
    event_id: conv.event_id || null,
    title: otherUser ? `${otherUser.first_name} ${otherUser.last_name}`.trim() : grp?.name || conv.title,
    other_user: otherUser,
    participant_count: (conv.participants || []).length,
    last_message: lastMsg ? (lastMsg.is_unsent ? "This message was unsent" : lastMsg.content) : null,
    last_message_at: lastMsg ? lastMsg.created_at : conv.created_at || new Date().toISOString(),
    unread_count: unreadCount,
    updated_at: lastMsg ? lastMsg.created_at : conv.created_at || new Date().toISOString(),
    me_uid: meUid,
  };
}

function formatMessages(state, conv) {
  const blocked = new Set(state.blockedIds);
  return (conv.messages || [])
    .filter((m) => !(m.hidden_for || []).some(isMeId) && !blocked.has(m.sender_id))
    .map((m) => {
      const sender = getUserById(state, m.sender_id, false);
      return {
        id: m.id,
        chat_id: conv.id,
        sender_id: normalizeIdForMe(m.sender_id),
        sender_name: sender ? `${sender.first_name} ${sender.last_name}`.trim() : "Student",
        sender_avatar: sender?.profile_picture || null,
        content: m.is_unsent ? "This message was unsent" : m.content,
        is_unsent: Boolean(m.is_unsent),
        is_read: Array.isArray(m.read_by) && m.read_by.some((uid) => uid !== m.sender_id),
        created_at: m.created_at,
      };
    });
}

function emitConversationUpdate(state) {
  const list = state.conversations
    .map((c) => formatConversation(state, c))
    .filter(Boolean)
    .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
  convListeners.forEach((cb) => {
    try {
      cb(list);
    } catch {
      // Ignore listener errors
    }
  });
}

function emitMessageUpdate(state, chatId) {
  const conv = state.conversations.find((c) => c.id === chatId);
  if (!conv) return;
  const msgs = formatMessages(state, conv);
  const listeners = msgListeners.get(chatId);
  if (listeners) {
    listeners.forEach((cb) => {
      try {
        cb(msgs);
      } catch {
        // Ignore
      }
    });
  }
}

function emitNotificationsUpdate() {
  notifListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // Ignore
    }
  });
}

function emitEventsUpdate(state) {
  const list = state.events
    .map((e) => formatEvent(state, e))
    .sort((a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime());
  eventListeners.forEach((cb) => {
    try {
      cb(list);
    } catch {
      // Ignore
    }
  });
}

function generateSimulatedReply(conv, userText, state) {
  const lower = userText.toLowerCase();
  const isGroup = conv.type === "group";
  const participants = (conv.participants || []).filter((p) => !isMeId(p) && !state.blockedIds.includes(p));
  const responderId = participants[Math.floor(Math.random() * participants.length)] || "stu_01";
  const responder = getUserById(state, responderId, false);
  const firstName = responder?.first_name || "Elena";

  let text;
  if (/(time|when|hour|what time|meet)/.test(lower)) {
    text = isGroup
      ? `Hey! Most of us are aiming to meet around 15–20 minutes early at the main entrance. Does that work for you?`
      : `Let's aim to meet about 20 minutes before it starts so we have time to grab coffee first!`;
  } else if (/(where|spot|place|location|address)/.test(lower)) {
    text = `Right by the main entrance / fountain in Piata Unirii is super easy to spot — I'll message here when I arrive!`;
  } else if (/(coffee|tea|drink|food|pizza)/.test(lower)) {
    text = `Yes! Always down for specialty coffee beforehand. See you there!`;
  } else if (/(code|repo|hackathon|github|stack|project)/.test(lower)) {
    text = `Sweet, I'll push the latest branch tonight so we're ready to roll right at kickoff!`;
  } else if (/(game|rocket|valorant|catan|controller|play)/.test(lower)) {
    text = `Awesome, I'll save you a seat on the team! Bringing extra controllers just in case.`;
  } else if (/(hike|trail|carpool|car|mountain)/.test(lower)) {
    text = `Great! We still have room in the carpool and the sunrise forecast looks super clear.`;
  } else if (/(hi|hey|hello|salut|morning|evening)/.test(lower)) {
    text = `Hey Alex! Good to hear from you — how's your week going?`;
  } else if (/(thanks|thank|awesome|cool|great|sounds good|perfect|see you)/.test(lower)) {
    text = `Sounds like a plan! Catch you soon 🙌`;
  } else {
    text = isGroup
      ? `Sounds good Alex! Looking forward to seeing everyone there — ${firstName} here, I'll bring snacks.`
      : `Got it! That sounds great, let's lock that in.`;
  }

  return { responderId, text };
}

export const DemoStore = {
  isDemoSession() {
    const email = auth.currentUser?.email?.toLowerCase();
    if (email === CONFIG.DEMO_ACCOUNT.email) return true;
    try {
      if (sessionStorage.getItem(OFFLINE_DEMO_KEY) === "1" && !auth.currentUser) return true;
    } catch {
      // Ignore
    }
    return false;
  },

  activateOfflineDemoSession() {
    try {
      sessionStorage.setItem(OFFLINE_DEMO_KEY, "1");
    } catch {
      // Ignore
    }
    loadState();
  },

  clearOfflineDemoSession() {
    try {
      sessionStorage.removeItem(OFFLINE_DEMO_KEY);
    } catch {
      // Ignore
    }
    pendingReplyTimers.forEach((t) => clearTimeout(t));
    pendingReplyTimers.clear();
  },

  ensureInitialized() {
    return loadState();
  },

  reset() {
    pendingReplyTimers.forEach((t) => clearTimeout(t));
    pendingReplyTimers.clear();
    const fresh = createSeedState();
    saveState(fresh);
    emitConversationUpdate(fresh);
    emitEventsUpdate(fresh);
    emitNotificationsUpdate();
    return formatMe(fresh);
  },

  me() {
    const state = loadState();
    return formatMe(state);
  },

  getUserProfile(uid) {
    const state = loadState();
    const user = getUserById(state, String(uid), true);
    if (!user) throw makeError("User profile not found.", 404);
    return user;
  },

  updateMyProfile(payload) {
    const state = loadState();
    state.me = {
      ...state.me,
      first_name: String(payload.first_name || state.me.first_name).trim(),
      last_name: String(payload.last_name || state.me.last_name).trim(),
      display_name: `${payload.first_name || state.me.first_name} ${payload.last_name || state.me.last_name}`.trim(),
      username: String(payload.username || state.me.username).trim(),
      email: String(payload.email || state.me.email).trim(),
      age: payload.age ? Number(payload.age) : null,
      city: payload.city || null,
      university: payload.university || null,
      profile_picture: payload.profile_picture !== undefined ? payload.profile_picture : state.me.profile_picture,
      bio: payload.bio || null,
      hobbies: Array.isArray(payload.hobbies) ? payload.hobbies.slice(0, 20) : state.me.hobbies,
      updated_at: new Date().toISOString(),
    };
    saveState(state);
    return formatMe(state);
  },

  getMyHobbies() {
    const state = loadState();
    return {
      selected_hobbies: [...(state.me.hobbies || [])],
      suggested_hobbies: SUGGESTED_HOBBIES,
    };
  },

  updateMyHobbies(hobbies) {
    const state = loadState();
    const cleaned = [...new Set((hobbies || []).map((h) => String(h).trim()).filter(Boolean))].slice(0, 20);
    state.me.hobbies = cleaned;
    state.me.updated_at = new Date().toISOString();
    saveState(state);
    return {
      selected_hobbies: cleaned,
      suggested_hobbies: SUGGESTED_HOBBIES,
    };
  },

  getMyInterests() {
    const state = loadState();
    return {
      available_interests: INTERESTS_CATALOG,
      selected_interests: mapInterestsToUiObjects(state.me.interest_names),
    };
  },

  updateMyInterests(interestIdsOrNames) {
    const state = loadState();
    const names = [
      ...new Set(
        (interestIdsOrNames || []).map((val) => {
          const byId = INTEREST_BY_ID.get(String(val));
          if (byId) return byId.name;
          const byName = INTEREST_BY_NAME.get(String(val).toLowerCase());
          return byName ? byName.name : String(val);
        })
      ),
    ].slice(0, 30);
    state.me.interest_names = names;
    state.me.updated_at = new Date().toISOString();
    saveState(state);
    return {
      available_interests: INTERESTS_CATALOG,
      selected_interests: mapInterestsToUiObjects(names),
    };
  },

  // ---------------------------------------------------------------------------
  // People Discovery, Search & Follow
  // ---------------------------------------------------------------------------
  discoverUsers({ city = "", university = "", q = "", relation = "all", limit = 30 } = {}) {
    const state = loadState();
    const blocked = new Set(state.blockedIds);
    const following = new Set(state.followingIds);
    const followers = new Set(state.followerIds);
    const cityLow = city.trim().toLowerCase();
    const uniLow = university.trim().toLowerCase();
    const qLow = q.trim().toLowerCase();

    return state.students
      .filter((s) => {
        if (blocked.has(s.id)) return false;
        if (cityLow && !(s.city || "").toLowerCase().includes(cityLow)) return false;
        if (uniLow && !(s.university || "").toLowerCase().includes(uniLow)) return false;
        if (relation === "following" && !following.has(s.id)) return false;
        if (relation === "followers" && !followers.has(s.id)) return false;
        if (relation === "new" && (following.has(s.id) || followers.has(s.id))) return false;
        if (qLow) {
          const blob = `${s.first_name} ${s.last_name} ${s.username} ${s.bio || ""} ${(s.hobbies || []).join(" ")} ${(s.interest_names || []).join(" ")}`.toLowerCase();
          if (!blob.includes(qLow)) return false;
        }
        return true;
      })
      .map((s) => formatUser(state, s, true))
      .sort((a, b) => (b.compatibility?.compatibility || 0) - (a.compatibility?.compatibility || 0))
      .slice(0, limit);
  },

  getCommunity({ university = "", city = "", q = "", relation = "all" } = {}) {
    const students = DemoStore.discoverUsers({ university, city, q, relation, limit: 50 });
    return {
      university: university || null,
      students,
    };
  },

  listUniversities() {
    const state = loadState();
    const counts = new Map();
    [state.me, ...state.students].forEach((u) => {
      const uni = (u.university || "").trim();
      if (uni) counts.set(uni, (counts.get(uni) || 0) + 1);
    });
    return [...counts.entries()]
      .map(([university, student_count]) => ({ university, student_count }))
      .sort((a, b) => b.student_count - a.student_count);
  },

  toggleFollowUser(targetUid) {
    const state = loadState();
    const tid = String(targetUid);
    if (isMeId(tid)) throw makeError("You cannot follow yourself.", 400);
    const idx = state.followingIds.indexOf(tid);
    const target = state.students.find((s) => s.id === tid);
    if (!target) throw makeError("Student not found.", 404);

    let isFollowing;
    if (idx >= 0) {
      state.followingIds.splice(idx, 1);
      isFollowing = false;
    } else {
      state.followingIds.push(tid);
      isFollowing = true;
    }
    saveState(state);
    return {
      is_following: isFollowing,
      user: formatUser(state, target, true),
    };
  },

  startDirectChatWithUser(targetUid) {
    const state = loadState();
    const tid = String(targetUid);
    const target = state.students.find((s) => s.id === tid);
    if (!target) throw makeError("Student not found.", 404);

    let conv = state.conversations.find(
      (c) => c.type !== "group" && (c.participants || []).includes(tid)
    );
    if (!conv) {
      conv = {
        id: generateId("conv"),
        type: "direct",
        title: `${target.first_name} ${target.last_name}`,
        participants: [ME_TOKEN, tid],
        created_at: new Date().toISOString(),
        messages: [],
      };
      state.conversations.unshift(conv);
      saveState(state);
      emitConversationUpdate(state);
    }
    return { conversation_id: conv.id };
  },

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  listEvents({ q = "", category = "", city = "", university = "", date = "", timeframe = "all", page = 1, limit = 100 } = {}) {
    const state = loadState();
    const qLow = q.trim().toLowerCase();
    const catLow = category.trim().toLowerCase();
    const cityLow = city.trim().toLowerCase();
    const uniLow = university.trim().toLowerCase();
    const dateFilter = date.trim();
    const nowMs = Date.now();

    const filtered = state.events
      .map((ev) => formatEvent(state, ev))
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

    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(Math.max(1, page), pages);
    const start = (safePage - 1) * limit;
    return {
      items: filtered.slice(start, start + limit),
      total,
      page: safePage,
      pages,
    };
  },

  subscribeToEvents(onUpdate) {
    eventListeners.add(onUpdate);
    return () => eventListeners.delete(onUpdate);
  },

  getEvent(eventId) {
    const state = loadState();
    const ev = state.events.find((e) => e.id === String(eventId));
    if (!ev) throw makeError("Event not found.", 404);
    return formatEvent(state, ev);
  },

  getEventParticipants(eventId) {
    const state = loadState();
    const ev = state.events.find((e) => e.id === String(eventId));
    if (!ev) throw makeError("Event not found.", 404);
    return (ev.participant_ids || [])
      .filter((uid) => !state.blockedIds.includes(uid))
      .map((uid) => {
        const user = getUserById(state, uid, false) || {
          id: uid,
          first_name: "UniMeet",
          last_name: "Student",
          username: "student",
        };
        return {
          user_id: user.id,
          joined_at: ev.created_at,
          user,
        };
      });
  },

  createEvent(payload) {
    const state = loadState();
    const me = formatMe(state);
    const startIso = new Date(payload.start_datetime).toISOString();
    const newEv = {
      id: generateId("ev"),
      title: String(payload.title).trim(),
      description: String(payload.description).trim(),
      location: String(payload.location).trim(),
      city: String(payload.city).trim(),
      university: payload.university ? String(payload.university).trim() : null,
      date: startIso.slice(0, 10),
      start_datetime: startIso,
      end_datetime: payload.end_datetime ? new Date(payload.end_datetime).toISOString() : null,
      category: String(payload.category).trim(),
      creator_id: ME_TOKEN,
      organizer_name: `${me.first_name} ${me.last_name}`.trim(),
      organizer_university: me.university || null,
      max_participants: payload.max_participants ? Number(payload.max_participants) : null,
      participant_ids: [ME_TOKEN],
      liked_by: [ME_TOKEN],
      image_url: payload.image_url || "assets/images/event-coffee.jpg",
      is_active: true,
      is_sample: false,
      created_at: new Date().toISOString(),
    };
    state.events.unshift(newEv);
    saveState(state);
    emitEventsUpdate(state);
    return formatEvent(state, newEv);
  },

  updateEvent(eventId, payload) {
    const state = loadState();
    const ev = state.events.find((e) => e.id === String(eventId));
    if (!ev) throw makeError("Event not found.", 404);
    if (payload.title) ev.title = String(payload.title).trim();
    if (payload.description) ev.description = String(payload.description).trim();
    if (payload.location) ev.location = String(payload.location).trim();
    if (payload.city) ev.city = String(payload.city).trim();
    if (payload.category) ev.category = String(payload.category).trim();
    if (payload.university !== undefined) ev.university = payload.university || null;
    if (payload.start_datetime) {
      ev.start_datetime = new Date(payload.start_datetime).toISOString();
      ev.date = ev.start_datetime.slice(0, 10);
    }
    if (payload.max_participants !== undefined) {
      ev.max_participants = payload.max_participants ? Number(payload.max_participants) : null;
    }
    if (payload.image_url !== undefined) ev.image_url = payload.image_url || ev.image_url;
    saveState(state);
    emitEventsUpdate(state);
    return formatEvent(state, ev);
  },

  deleteEvent(eventId) {
    const state = loadState();
    state.events = state.events.filter((e) => e.id !== String(eventId));
    saveState(state);
    emitEventsUpdate(state);
    return { ok: true };
  },

  joinEvent(eventId) {
    const state = loadState();
    const ev = state.events.find((e) => e.id === String(eventId));
    if (!ev) throw makeError("Event not found.", 404);
    if ((ev.participant_ids || []).some(isMeId)) {
      throw makeError("You have already joined this event.", 409);
    }
    if (ev.max_participants && ev.participant_ids.length >= ev.max_participants) {
      throw makeError("This event is already full.", 409);
    }
    ev.participant_ids.push(ME_TOKEN);
    saveState(state);
    emitEventsUpdate(state);
    return formatEvent(state, ev);
  },

  leaveEvent(eventId) {
    const state = loadState();
    const ev = state.events.find((e) => e.id === String(eventId));
    if (!ev) throw makeError("Event not found.", 404);
    ev.participant_ids = (ev.participant_ids || []).filter((id) => !isMeId(id));
    saveState(state);
    emitEventsUpdate(state);
    return formatEvent(state, ev);
  },

  likeEvent(eventId) {
    const state = loadState();
    const ev = state.events.find((e) => e.id === String(eventId));
    if (!ev) throw makeError("Event not found.", 404);
    if (!(ev.liked_by || []).some(isMeId)) {
      ev.liked_by.push(ME_TOKEN);
    }
    if (ev.category && !state.me.liked_categories.includes(ev.category)) {
      state.me.liked_categories.push(ev.category);
    }
    if (!isMeId(ev.creator_id)) {
      const existingConv = state.conversations.find(
        (c) => c.type !== "group" && (c.participants || []).includes(ev.creator_id)
      );
      if (!existingConv) {
        const host = getUserById(state, ev.creator_id, false);
        state.conversations.unshift({
          id: generateId("conv"),
          type: "direct",
          event_id: ev.id,
          title: host ? `${host.first_name} ${host.last_name}` : ev.organizer_name,
          participants: [ME_TOKEN, ev.creator_id],
          created_at: new Date().toISOString(),
          messages: [
            {
              id: generateId("msg"),
              sender_id: ME_TOKEN,
              content: `Hi! I liked your outing "${ev.title}" and would love to hear more.`,
              created_at: new Date().toISOString(),
              read_by: [ME_TOKEN],
            },
          ],
        });
        emitConversationUpdate(state);
      }
    }
    saveState(state);
    emitEventsUpdate(state);
    return formatEvent(state, ev);
  },

  unlikeEvent(eventId) {
    const state = loadState();
    const ev = state.events.find((e) => e.id === String(eventId));
    if (!ev) throw makeError("Event not found.", 404);
    ev.liked_by = (ev.liked_by || []).filter((id) => !isMeId(id));
    saveState(state);
    emitEventsUpdate(state);
    return formatEvent(state, ev);
  },

  seedSampleEvents() {
    const state = loadState();
    return { count: state.events.length };
  },

  // ---------------------------------------------------------------------------
  // Matches & Liked Events
  // ---------------------------------------------------------------------------
  likeUser(receiverId, eventId) {
    const state = loadState();
    const rUid = String(receiverId);
    const eId = String(eventId);
    const key = `${rUid}__${eId}`;
    if (state.userLikesSent.includes(key)) {
      throw makeError("Already liked this person for this event.", 409);
    }
    state.userLikesSent.push(key);

    const ev = state.events.find((e) => e.id === eId) || state.events[0];
    const otherUser = getUserById(state, rUid, true);
    if (!otherUser) throw makeError("User not found.", 404);

    const isReciprocal = state.preLikedDemoUserIds.includes(rUid) || state.followerIds.includes(rUid);
    if (isReciprocal) {
      let conv = state.conversations.find((c) => c.type !== "group" && (c.participants || []).includes(rUid));
      if (!conv) {
        conv = {
          id: generateId("conv"),
          type: "direct",
          event_id: ev.id,
          title: `${otherUser.first_name} ${otherUser.last_name}`,
          participants: [ME_TOKEN, rUid],
          created_at: new Date().toISOString(),
          messages: [
            {
              id: generateId("msg"),
              sender_id: rUid,
              content: `Hey Alex! Looks like we matched for ${ev.title} — are you thinking of going?`,
              created_at: new Date().toISOString(),
              read_by: [rUid],
            },
          ],
        };
        state.conversations.unshift(conv);
      }

      const matchObj = {
        id: generateId("match"),
        other_user_id: rUid,
        event_id: ev.id,
        event_title: ev.title,
        conversation_id: conv.id,
        status: "active",
        created_at: new Date().toISOString(),
      };
      state.matches.unshift(matchObj);
      state.notifications.unshift({
        id: generateId("notif"),
        type: "match",
        actor_id: rUid,
        title: `It's a match with ${otherUser.first_name} ${otherUser.last_name}!`,
        body: `You both want to check out ${ev.title}.`,
        target_type: "conversation",
        target_id: conv.id,
        is_read: false,
        created_at: new Date().toISOString(),
      });
      saveState(state);
      emitConversationUpdate(state);
      emitNotificationsUpdate();

      return {
        is_match: true,
        match: {
          id: matchObj.id,
          event_id: ev.id,
          event_title: ev.title,
          conversation_id: conv.id,
          created_at: matchObj.created_at,
          other_user: otherUser,
        },
      };
    }

    saveState(state);
    return { is_match: false, match: null };
  },

  listMatches() {
    const state = loadState();
    const blocked = new Set(state.blockedIds);
    return state.matches
      .filter((m) => m.status === "active" && !blocked.has(m.other_user_id))
      .map((m) => ({
        id: m.id,
        event_id: m.event_id,
        event_title: m.event_title,
        conversation_id: m.conversation_id,
        created_at: m.created_at,
        other_user: getUserById(state, m.other_user_id, true),
      }))
      .filter((m) => Boolean(m.other_user))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  deleteMatch(matchId) {
    const state = loadState();
    const m = state.matches.find((x) => x.id === String(matchId));
    if (m) m.status = "unmatched";
    saveState(state);
    return { ok: true };
  },

  listLikedEvents() {
    const state = loadState();
    return state.events
      .filter((e) => (e.liked_by || []).some(isMeId))
      .map((ev) => {
        const formattedEv = formatEvent(state, ev);
        const creator = getUserById(state, ev.creator_id, false) || {
          id: normalizeIdForMe(ev.creator_id),
          first_name: ev.organizer_name?.split(" ")[0] || "Event",
          last_name: ev.organizer_name?.split(" ").slice(1).join(" ") || "Host",
          university: ev.organizer_university || ev.university || null,
        };
        const conv = state.conversations.find(
          (c) => c.type !== "group" && (c.participants || []).includes(ev.creator_id)
        );
        return {
          event: formattedEv,
          creator,
          conversation_id: conv ? conv.id : null,
        };
      });
  },

  // ---------------------------------------------------------------------------
  // Groups & Memberships
  // ---------------------------------------------------------------------------
  listGroups({ q = "", category = "", university = "", city = "" } = {}) {
    const state = loadState();
    const qLow = q.trim().toLowerCase();
    const catLow = category.trim().toLowerCase();
    const uniLow = university.trim().toLowerCase();
    const cityLow = city.trim().toLowerCase();

    return state.groups
      .map((g) => formatGroup(state, g))
      .filter((g) => {
        if (qLow && !`${g.name} ${g.description} ${g.category || ""} ${g.interests_summary || ""}`.toLowerCase().includes(qLow)) {
          return false;
        }
        if (catLow && (g.category || "").toLowerCase() !== catLow) return false;
        if (uniLow && !(g.university || "").toLowerCase().includes(uniLow)) return false;
        if (cityLow && !(g.location || "").toLowerCase().includes(cityLow)) return false;
        return true;
      })
      .sort((a, b) => Number(b.is_member) - Number(a.is_member));
  },

  createGroup(payload) {
    const state = loadState();
    const groupId = generateId("grp");
    const convId = generateId("conv_grp");
    let eventTitle = null;
    if (payload.event_id) {
      const ev = state.events.find((e) => e.id === String(payload.event_id));
      if (ev) eventTitle = ev.title;
    }

    const newGroup = {
      id: groupId,
      name: String(payload.name).trim(),
      category: String(payload.category || "Events & Social Activities").trim(),
      description: String(payload.description).trim(),
      cover_image: payload.cover_image || "assets/images/event-rooftop.jpg",
      creator_id: ME_TOKEN,
      event_id: payload.event_id ? String(payload.event_id) : null,
      event_title: eventTitle,
      max_members: Number(payload.max_members || 12),
      member_ids: [ME_TOKEN],
      member_count: 1,
      is_public: Boolean(payload.is_public),
      university: payload.university || null,
      location: payload.location || null,
      interests_summary: payload.interests_summary || null,
      conversation_id: convId,
      membership_status: "active",
      created_at: new Date().toISOString(),
    };

    state.groups.unshift(newGroup);
    state.conversations.unshift({
      id: convId,
      type: "group",
      group_id: groupId,
      title: newGroup.name,
      participants: [ME_TOKEN],
      created_at: new Date().toISOString(),
      messages: [
        {
          id: generateId("msg"),
          sender_id: ME_TOKEN,
          content: `Created the group "${newGroup.name}" — welcome everyone!`,
          created_at: new Date().toISOString(),
          read_by: [ME_TOKEN],
        },
      ],
    });
    saveState(state);
    emitConversationUpdate(state);
    return { id: groupId, conversation_id: convId };
  },

  getGroupMembers(groupId) {
    const state = loadState();
    const grp = state.groups.find((g) => g.id === String(groupId));
    if (!grp) throw makeError("Group not found.", 404);
    return (grp.member_ids || [])
      .filter((uid) => !state.blockedIds.includes(uid))
      .map((uid) => {
        const user = getUserById(state, uid, false);
        return {
          user_id: normalizeIdForMe(uid),
          role: uid === grp.creator_id ? "admin" : "member",
          status: "active",
          joined_at: grp.created_at,
          user: user || { id: uid, first_name: "UniMeet", last_name: "Member", username: "student" },
        };
      });
  },

  joinGroup(groupId) {
    const state = loadState();
    const grp = state.groups.find((g) => g.id === String(groupId));
    if (!grp) throw makeError("Group not found.", 404);
    if (grp.membership_status === "active") {
      throw makeError("You are already a member of this group.", 409);
    }
    if (grp.member_count >= grp.max_members) {
      throw makeError("This group is already full.", 409);
    }

    if (grp.is_public || grp.membership_status === "invited") {
      grp.membership_status = "active";
      if (!grp.member_ids.some(isMeId)) grp.member_ids.unshift(ME_TOKEN);
      grp.member_count += 1;
      let conv = state.conversations.find((c) => c.id === grp.conversation_id);
      if (!conv) {
        conv = {
          id: grp.conversation_id || generateId("conv_grp"),
          type: "group",
          group_id: grp.id,
          title: grp.name,
          participants: [ME_TOKEN, ...(grp.member_ids || []).filter((id) => !isMeId(id))],
          created_at: new Date().toISOString(),
          messages: [
            {
              id: generateId("msg"),
              sender_id: grp.creator_id,
              content: `Welcome to ${grp.name}, Alex! Glad you joined us.`,
              created_at: new Date().toISOString(),
              read_by: [grp.creator_id],
            },
          ],
        };
        grp.conversation_id = conv.id;
        state.conversations.unshift(conv);
      } else if (!conv.participants.some(isMeId)) {
        conv.participants.push(ME_TOKEN);
      }
      state.notifications.forEach((n) => {
        if (n.type === "group_invite" && n.target_id === grp.id) n.is_read = true;
      });
    } else {
      grp.membership_status = "pending";
    }

    saveState(state);
    emitConversationUpdate(state);
    emitNotificationsUpdate();
    return { ok: true, group: formatGroup(state, grp) };
  },

  declineGroupInvite(groupId) {
    const state = loadState();
    const grp = state.groups.find((g) => g.id === String(groupId));
    if (grp && grp.membership_status === "invited") {
      grp.membership_status = null;
    }
    state.notifications = state.notifications.filter(
      (n) => !(n.type === "group_invite" && n.target_id === String(groupId))
    );
    saveState(state);
    emitNotificationsUpdate();
    return { ok: true };
  },

  approveGroupMember() {
    return { ok: true };
  },

  leaveGroup(groupId) {
    const state = loadState();
    const grp = state.groups.find((g) => g.id === String(groupId));
    if (!grp) return { ok: true };
    if (grp.membership_status === "active") {
      grp.member_count = Math.max(0, grp.member_count - 1);
    }
    grp.membership_status = null;
    grp.member_ids = (grp.member_ids || []).filter((id) => !isMeId(id));
    const conv = state.conversations.find((c) => c.id === grp.conversation_id);
    if (conv) {
      conv.participants = (conv.participants || []).filter((id) => !isMeId(id));
    }
    saveState(state);
    emitConversationUpdate(state);
    return { ok: true };
  },

  deleteGroup(groupId) {
    const state = loadState();
    const id = String(groupId);
    state.groups = state.groups.filter((g) => g.id !== id);
    state.conversations = state.conversations.filter((c) => c.group_id !== id);
    saveState(state);
    emitConversationUpdate(state);
    return { ok: true };
  },

  // ---------------------------------------------------------------------------
  // Going Solo
  // ---------------------------------------------------------------------------
  listSolo({ city = "", university = "" } = {}) {
    const state = loadState();
    const blocked = new Set(state.blockedIds);
    const cityLow = city.trim().toLowerCase();
    const uniLow = university.trim().toLowerCase();
    const nowMs = Date.now();

    return state.soloPosts
      .filter((s) => s.status === "active" && !blocked.has(s.user_id) && new Date(s.expires_at).getTime() > nowMs)
      .map((s) => {
        const ev = state.events.find((e) => e.id === s.event_id);
        const author = getUserById(state, s.user_id, true);
        return {
          id: s.id,
          user_id: normalizeIdForMe(s.user_id),
          event_id: s.event_id,
          event_title: ev?.title || "Campus Outing",
          event_city: ev?.city || "Timisoara",
          event_start_datetime: ev?.start_datetime || hoursAhead(24),
          message: s.message,
          status: s.status,
          interest_count: s.interest_count,
          is_sample: false,
          has_expressed_interest: Boolean(s.expressed_by_me),
          created_at: s.created_at,
          expires_at: s.expires_at,
          user: author,
        };
      })
      .filter((s) => {
        if (cityLow && !(s.event_city || "").toLowerCase().includes(cityLow)) return false;
        if (uniLow && !(s.user?.university || "").toLowerCase().includes(uniLow)) return false;
        return true;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  createSolo({ event_id, message, expires_hours = 48 }) {
    const state = loadState();
    const trimmed = String(message || "").trim();
    if (trimmed.length < 5) throw makeError("Personal note must be at least 5 characters.", 400);
    const ev = state.events.find((e) => e.id === String(event_id));
    if (!ev) throw makeError("Event not found.", 404);
    const id = generateId("solo");
    state.soloPosts.unshift({
      id,
      user_id: ME_TOKEN,
      event_id: ev.id,
      message: trimmed,
      status: "active",
      interest_count: 0,
      expressed_by_me: false,
      created_at: new Date().toISOString(),
      expires_at: hoursAhead(Number(expires_hours || 48)),
    });
    saveState(state);
    return { id };
  },

  deleteSolo(soloId) {
    const state = loadState();
    const item = state.soloPosts.find((s) => s.id === String(soloId));
    if (item) item.status = "inactive";
    saveState(state);
    return { ok: true };
  },

  expressSoloInterest(soloId) {
    const state = loadState();
    const item = state.soloPosts.find((s) => s.id === String(soloId));
    if (!item) throw makeError("Going Solo post not found.", 404);
    if (item.expressed_by_me) throw makeError("You already expressed interest.", 409);
    item.expressed_by_me = true;
    item.interest_count += 1;

    const ev = state.events.find((e) => e.id === item.event_id);
    const author = getUserById(state, item.user_id, false);
    let conv = state.conversations.find((c) => c.type !== "group" && (c.participants || []).includes(item.user_id));
    if (!conv) {
      conv = {
        id: generateId("conv"),
        type: "direct",
        event_id: item.event_id,
        title: author ? `${author.first_name} ${author.last_name}` : "Student",
        participants: [ME_TOKEN, item.user_id],
        created_at: new Date().toISOString(),
        messages: [],
      };
      state.conversations.unshift(conv);
    }
    conv.messages.push({
      id: generateId("msg"),
      sender_id: ME_TOKEN,
      content: `Hey! I saw your Going Solo post for "${ev?.title || "the event"}" — want to team up?`,
      created_at: new Date().toISOString(),
      read_by: [ME_TOKEN],
    });
    saveState(state);
    emitConversationUpdate(state);
    return { conversation_id: conv.id };
  },

  // ---------------------------------------------------------------------------
  // Messaging & Simulated Replies
  // ---------------------------------------------------------------------------
  listConversations() {
    const state = loadState();
    return state.conversations
      .filter((c) => c.type !== "group" || (c.participants || []).some(isMeId))
      .map((c) => formatConversation(state, c))
      .filter(Boolean)
      .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
  },

  subscribeToConversations(me, onUpdate) {
    convListeners.add(onUpdate);
    return () => convListeners.delete(onUpdate);
  },

  getConversation(chatId) {
    const state = loadState();
    const id = String(chatId);
    const conv = state.conversations.find((c) => c.id === id);
    if (!conv) throw makeError("Conversation not found.", 404);

    // Mark incoming messages as read when opening thread
    let changed = false;
    (conv.messages || []).forEach((m) => {
      if (!isMeId(m.sender_id) && !(m.read_by || []).some(isMeId)) {
        m.read_by = [...(m.read_by || []), ME_TOKEN];
        changed = true;
      }
    });
    if (changed) {
      state.notifications.forEach((n) => {
        if (n.type === "message" && n.target_id === id) n.is_read = true;
      });
      saveState(state);
      emitConversationUpdate(state);
      emitNotificationsUpdate();
    }

    const hydrated = formatConversation(state, conv);
    if (!hydrated) throw makeError("Conversation unavailable.", 403);
    return {
      conversation: hydrated,
      messages: formatMessages(state, conv),
    };
  },

  subscribeToMessages(chatId, me, onUpdate) {
    const id = String(chatId);
    if (!msgListeners.has(id)) msgListeners.set(id, new Set());
    msgListeners.get(id).add(onUpdate);
    return () => {
      msgListeners.get(id)?.delete(onUpdate);
    };
  },

  sendMessage(chatId, content) {
    const state = loadState();
    const id = String(chatId);
    const text = String(content || "").trim();
    if (!text) throw makeError("Message cannot be empty.", 400);
    const conv = state.conversations.find((c) => c.id === id);
    if (!conv) throw makeError("Conversation not found.", 404);

    const newMsg = {
      id: generateId("msg"),
      sender_id: ME_TOKEN,
      content: text,
      created_at: new Date().toISOString(),
      read_by: [ME_TOKEN],
      is_unsent: false,
      hidden_for: [],
    };
    conv.messages.push(newMsg);
    saveState(state);
    emitConversationUpdate(state);

    // Schedule realistic simulated reply from participant
    const delay = 1100 + Math.floor(Math.random() * 900);
    const timer = window.setTimeout(() => {
      pendingReplyTimers.delete(timer);
      const nextState = loadState();
      const targetConv = nextState.conversations.find((c) => c.id === id);
      if (!targetConv) return;
      // Mark Alex's sent message as read by responder
      const sentMsg = targetConv.messages.find((m) => m.id === newMsg.id);
      const reply = generateSimulatedReply(targetConv, text, nextState);
      if (sentMsg && !sentMsg.read_by.includes(reply.responderId)) {
        sentMsg.read_by.push(reply.responderId);
      }
      const isViewingThread = msgListeners.has(id) && msgListeners.get(id).size > 0;
      targetConv.messages.push({
        id: generateId("msg"),
        sender_id: reply.responderId,
        content: reply.text,
        created_at: new Date().toISOString(),
        read_by: isViewingThread ? [reply.responderId, ME_TOKEN] : [reply.responderId],
        is_unsent: false,
        hidden_for: [],
      });
      saveState(nextState);
      emitMessageUpdate(nextState, id);
      emitConversationUpdate(nextState);
    }, delay);
    pendingReplyTimers.add(timer);

    const me = formatMe(state);
    return {
      id: newMsg.id,
      chat_id: id,
      sender_id: me.id,
      sender_name: `${me.first_name} ${me.last_name}`,
      sender_avatar: me.profile_picture,
      content: text,
      is_unsent: false,
      is_read: false,
      created_at: newMsg.created_at,
    };
  },

  markMessageRead(chatId, messageId) {
    const state = loadState();
    const conv = state.conversations.find((c) => c.id === String(chatId));
    if (!conv) return;
    const msg = (conv.messages || []).find((m) => m.id === String(messageId));
    if (msg && !(msg.read_by || []).some(isMeId)) {
      msg.read_by = [...(msg.read_by || []), ME_TOKEN];
      saveState(state);
      emitConversationUpdate(state);
    }
  },

  unsendMessage(chatId, messageId) {
    const state = loadState();
    const conv = state.conversations.find((c) => c.id === String(chatId));
    if (!conv) throw makeError("Conversation not found.", 404);
    const msg = conv.messages.find((m) => m.id === String(messageId));
    if (!msg) throw makeError("Message not found.", 404);
    msg.is_unsent = true;
    msg.content = "This message was unsent";
    saveState(state);
    emitConversationUpdate(state);
    return {
      id: msg.id,
      chat_id: conv.id,
      sender_id: normalizeIdForMe(msg.sender_id),
      content: "This message was unsent",
      is_unsent: true,
    };
  },

  deleteMessageForMe(chatId, messageId) {
    const state = loadState();
    const conv = state.conversations.find((c) => c.id === String(chatId));
    if (!conv) return { ok: true };
    const msg = conv.messages.find((m) => m.id === String(messageId));
    if (msg) {
      msg.hidden_for = [...(msg.hidden_for || []), ME_TOKEN];
      saveState(state);
      emitConversationUpdate(state);
    }
    return { ok: true };
  },

  getUnreadMessageCount() {
    const state = loadState();
    const convs = DemoStore.listConversations();
    return convs.reduce((acc, c) => acc + (c.unread_count || 0), 0);
  },

  // ---------------------------------------------------------------------------
  // Posts, Comments & Social Feed
  // ---------------------------------------------------------------------------
  listPosts({ filter = "all", groupId = "", authorId = "", q = "" } = {}) {
    const state = loadState();
    const blocked = new Set(state.blockedIds);
    const following = new Set(state.followingIds);
    const myGroupIds = new Set(state.groups.filter((g) => g.membership_status === "active").map((g) => g.id));
    const qLow = q.trim().toLowerCase();

    return state.posts
      .filter((p) => {
        if (blocked.has(p.author_id)) return false;
        if (groupId && p.group_id !== groupId) return false;
        if (authorId && normalizeIdForMe(p.author_id) !== normalizeIdForMe(authorId)) return false;
        if (filter === "following" && !following.has(p.author_id) && !isMeId(p.author_id)) return false;
        if (filter === "groups" && (!p.group_id || !myGroupIds.has(p.group_id))) return false;
        if (filter === "events" && !p.event_id) return false;
        if (filter === "mine" && !isMeId(p.author_id)) return false;
        if (qLow) {
          const author = getUserById(state, p.author_id, false);
          const authorText = author ? `${author.first_name} ${author.last_name} ${author.username}` : "";
          const grp = p.group_id ? state.groups.find((g) => g.id === p.group_id)?.name || "" : "";
          const blob = `${p.content} ${p.tag || ""} ${authorText} ${grp}`.toLowerCase();
          if (!blob.includes(qLow)) return false;
        }
        return true;
      })
      .map((p) => {
        const author = getUserById(state, p.author_id, false);
        const group = p.group_id ? state.groups.find((g) => g.id === p.group_id) : null;
        const event = p.event_id ? state.events.find((e) => e.id === p.event_id) : null;
        const comments = (p.comments || [])
          .filter((c) => !blocked.has(c.author_id))
          .map((c) => ({
            ...c,
            author_id: normalizeIdForMe(c.author_id),
            is_mine: isMeId(c.author_id),
            author: getUserById(state, c.author_id, false),
          }));

        return {
          id: p.id,
          author_id: normalizeIdForMe(p.author_id),
          is_mine: isMeId(p.author_id),
          author,
          content: p.content,
          image_url: p.image_url || null,
          tag: p.tag || "Campus Life",
          group_id: p.group_id || null,
          group_name: group?.name || null,
          event_id: p.event_id || null,
          event_title: event?.title || null,
          like_count: (p.liked_by || []).length,
          is_liked: (p.liked_by || []).some(isMeId),
          comment_count: comments.length,
          comments,
          created_at: p.created_at,
        };
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  createPost({ content, image_url = null, group_id = null, event_id = null, tag = "Campus Life" }) {
    const state = loadState();
    const text = String(content || "").trim();
    if (text.length < 3) throw makeError("Post content must be at least 3 characters.", 400);
    const post = {
      id: generateId("post"),
      author_id: ME_TOKEN,
      content: text,
      image_url: image_url || null,
      group_id: group_id || null,
      event_id: event_id || null,
      tag: String(tag || "Campus Life"),
      liked_by: [],
      comments: [],
      created_at: new Date().toISOString(),
    };
    state.posts.unshift(post);
    saveState(state);
    return DemoStore.listPosts().find((p) => p.id === post.id);
  },

  deletePost(postId) {
    const state = loadState();
    state.posts = state.posts.filter((p) => p.id !== String(postId));
    saveState(state);
    return { ok: true };
  },

  toggleLikePost(postId) {
    const state = loadState();
    const post = state.posts.find((p) => p.id === String(postId));
    if (!post) throw makeError("Post not found.", 404);
    const has = (post.liked_by || []).some(isMeId);
    if (has) {
      post.liked_by = post.liked_by.filter((id) => !isMeId(id));
    } else {
      post.liked_by.push(ME_TOKEN);
    }
    saveState(state);
    return {
      is_liked: !has,
      like_count: post.liked_by.length,
    };
  },

  addComment(postId, content) {
    const state = loadState();
    const text = String(content || "").trim();
    if (!text) throw makeError("Comment cannot be empty.", 400);
    const post = state.posts.find((p) => p.id === String(postId));
    if (!post) throw makeError("Post not found.", 404);

    const comment = {
      id: generateId("cmt"),
      author_id: ME_TOKEN,
      content: text,
      created_at: new Date().toISOString(),
    };
    post.comments.push(comment);
    saveState(state);
    return DemoStore.listPosts().find((p) => p.id === post.id);
  },

  deleteComment(postId, commentId) {
    const state = loadState();
    const post = state.posts.find((p) => p.id === String(postId));
    if (!post) throw makeError("Post not found.", 404);
    post.comments = (post.comments || []).filter((c) => c.id !== String(commentId));
    saveState(state);
    return DemoStore.listPosts().find((p) => p.id === post.id);
  },

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------
  listNotifications() {
    const state = loadState();
    return state.notifications
      .map((n) => ({
        ...n,
        actor: n.actor_id ? getUserById(state, n.actor_id, false) : null,
      }))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  getUnreadNotificationCount() {
    const state = loadState();
    return state.notifications.filter((n) => !n.is_read).length;
  },

  markNotificationRead(notifId) {
    const state = loadState();
    const item = state.notifications.find((n) => n.id === String(notifId));
    if (item) {
      item.is_read = true;
      saveState(state);
      emitNotificationsUpdate();
    }
    return { ok: true };
  },

  markAllNotificationsRead() {
    const state = loadState();
    state.notifications.forEach((n) => {
      n.is_read = true;
    });
    saveState(state);
    emitNotificationsUpdate();
    return { ok: true };
  },

  subscribeToNotifications(cb) {
    notifListeners.add(cb);
    return () => notifListeners.delete(cb);
  },

  // ---------------------------------------------------------------------------
  // Safety: Block / Unblock / Report
  // ---------------------------------------------------------------------------
  listBlocked() {
    const state = loadState();
    return state.blockedIds.map((uid) => ({
      blocked_id: uid,
      created_at: new Date().toISOString(),
      blocked_user: getUserById(state, uid, false) || {
        id: uid,
        first_name: "Blocked",
        last_name: "Account",
        username: "user",
      },
    }));
  },

  blockUser(targetUid) {
    const state = loadState();
    const tid = String(targetUid);
    if (!state.blockedIds.includes(tid)) {
      state.blockedIds.push(tid);
      state.followingIds = state.followingIds.filter((id) => id !== tid);
      state.followerIds = state.followerIds.filter((id) => id !== tid);
      saveState(state);
      emitConversationUpdate(state);
    }
    return { ok: true };
  },

  unblockUser(targetUid) {
    const state = loadState();
    const tid = String(targetUid);
    state.blockedIds = state.blockedIds.filter((id) => id !== tid);
    saveState(state);
    emitConversationUpdate(state);
    return { ok: true };
  },

  reportUser({ reported_user_id, reason, description }) {
    const state = loadState();
    const id = generateId("rpt");
    state.reports.push({
      id,
      reported_user_id: String(reported_user_id),
      reason,
      description: description || null,
      created_at: new Date().toISOString(),
    });
    saveState(state);
    return { id };
  },
};
