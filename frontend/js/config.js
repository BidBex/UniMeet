/**
 * Shared UniMeet configuration, catalogs, and optional clearly-labeled sample event presets.
 * Zero hardcoded localhost/REST/WebSocket endpoints — all data communicates via Firebase SDK.
 */

export const EVENT_CATEGORIES = [
  "Concert",
  "Festival",
  "Party",
  "Theatre",
  "Cinema",
  "Stand-up Comedy",
  "Sports",
  "Gaming",
  "Board Games",
  "Campus Meetup",
  "Tech & Coding",
  "Travel & Outdoors",
  "Art & Culture",
];

export const GROUP_CATEGORIES = [
  "Gaming",
  "Technology & Programming",
  "Sports & Fitness",
  "Music",
  "University & Studying",
  "Movies & Entertainment",
  "Travel",
  "General Discussions",
  "Local Communities",
  "Events & Social Activities",
];

export const INTERESTS_CATALOG = [
  { id: "indie_music", name: "Indie Music", category: "Music" },
  { id: "electronic_dj", name: "Electronic & DJ Sets", category: "Music" },
  { id: "jazz_acoustic", name: "Jazz & Acoustic", category: "Music" },
  { id: "festival_culture", name: "Festivals", category: "Music" },
  { id: "indie_cinema", name: "Indie Cinema", category: "Screen & Stage" },
  { id: "theatre_drama", name: "Theatre & Drama", category: "Screen & Stage" },
  { id: "standup_comedy", name: "Stand-up Comedy", category: "Screen & Stage" },
  { id: "board_games", name: "Board Games", category: "Games" },
  { id: "esports_gaming", name: "Gaming & Esports", category: "Games" },
  { id: "coffee_walks", name: "Coffee & City Walks", category: "Social" },
  { id: "campus_clubs", name: "Campus Meetups", category: "Social" },
  { id: "tech_coding", name: "Tech & Hackathons", category: "Tech" },
  { id: "photography", name: "Photography", category: "Creative" },
  { id: "art_galleries", name: "Art Galleries", category: "Creative" },
  { id: "running_cycling", name: "Running & Cycling", category: "Active" },
  { id: "bouldering", name: "Bouldering & Hiking", category: "Active" },
  { id: "foodie_spots", name: "Street Food & Markets", category: "Food" },
];

export const SUGGESTED_HOBBIES = [
  "Photography",
  "Bouldering",
  "Board Games",
  "Specialty Coffee",
  "Guitar",
  "Cycling",
  "Cooking",
  "Sketching",
  "Hiking",
  "Vinyl Collecting",
  "Film Making",
  "Running",
  "Chess",
  "Yoga",
  "Reading",
  "Baking",
  "3D Printing",
  "Gardening",
  "Table Tennis",
  "Volunteering",
];

export const EVENT_IMAGE_PRESETS = [
  { label: "Indie Concert", url: "assets/images/hero-concert.jpg" },
  { label: "Cinema & Film Club", url: "assets/images/event-cinema.jpg" },
  { label: "Board Games & Cafe", url: "assets/images/event-boardgames.jpg" },
  { label: "Campus Coffee Meetup", url: "assets/images/event-coffee.jpg" },
  { label: "Tech & Hackathon", url: "assets/images/event-hackathon.jpg" },
  { label: "Gaming & Esports", url: "assets/images/event-gaming.jpg" },
  { label: "Sports & Hoops", url: "assets/images/event-sports.jpg" },
  { label: "Rooftop Social", url: "assets/images/event-rooftop.jpg" },
  { label: "Mountain Travel", url: "assets/images/event-travel.jpg" },
  { label: "Music Festival", url: "assets/images/event-festival.jpg" },
];

/** Display-only cover photo used when an event document has no imageUrl (keyed by EVENT_CATEGORIES). */
export const CATEGORY_FALLBACK_IMAGES = {
  Concert: "assets/images/hero-concert.jpg",
  Festival: "assets/images/event-festival.jpg",
  Party: "assets/images/event-rooftop.jpg",
  Theatre: "assets/images/event-cinema.jpg",
  Cinema: "assets/images/event-cinema.jpg",
  "Stand-up Comedy": "assets/images/event-rooftop.jpg",
  Sports: "assets/images/event-sports.jpg",
  Gaming: "assets/images/event-gaming.jpg",
  "Board Games": "assets/images/event-boardgames.jpg",
  "Campus Meetup": "assets/images/event-coffee.jpg",
  "Tech & Coding": "assets/images/event-hackathon.jpg",
  "Travel & Outdoors": "assets/images/event-travel.jpg",
  "Art & Culture": "assets/images/event-cinema.jpg",
};

export const REPORT_REASONS = [
  { value: "harassment", label: "Harassment or abusive messages" },
  { value: "spam", label: "Spam or unwanted promotion" },
  { value: "inappropriate_content", label: "Inappropriate profile or event content" },
  { value: "fake_profile", label: "Fake or impersonated student profile" },
  { value: "safety_concern", label: "Real-world meetup safety concern" },
  { value: "other", label: "Other moderation issue" },
];

export const SAMPLE_EVENTS_TEMPLATES = [
  {
    title: "Timisoara Indie Acoustic Night",
    category: "Concert",
    location: "Bastion Theresia Courtyard",
    city: "Timisoara",
    university: "Politehnica University of Timisoara",
    description: "Casual acoustic live sets by student bands under the Bastion arches. Great spot to meet music fans before the show.",
    imageUrl: "assets/images/hero-concert.jpg",
    maximumParticipants: 35,
    daysAhead: 3,
    hour: 20,
  },
  {
    title: "European Indie Film Screening & Discussion",
    category: "Cinema",
    location: "Cinema Victoria",
    city: "Timisoara",
    university: "West University of Timisoara",
    description: "Evening screening followed by an informal coffee chat in Piata Unirii about cinematography and student film projects.",
    imageUrl: "assets/images/event-cinema.jpg",
    maximumParticipants: 20,
    daysAhead: 5,
    hour: 19,
  },
  {
    title: "Campus Board Games & Specialty Coffee",
    category: "Board Games",
    location: "Student Complex Cafe",
    city: "Timisoara",
    university: "Politehnica University of Timisoara",
    description: "Bring friends or join solo — Catan, Codenames, Dixit, and Azul tables ready for newcomers.",
    imageUrl: "assets/images/event-boardgames.jpg",
    maximumParticipants: 16,
    daysAhead: 2,
    hour: 18,
  },
  {
    title: "Newcomers Campus Coffee Walk",
    category: "Campus Meetup",
    location: "Piata Victoriei Fountain",
    city: "Timisoara",
    university: "West University of Timisoara",
    description: "Friendly sunset walk along the Bega canal for international, Erasmus, and local students looking to expand their circle.",
    imageUrl: "assets/images/event-coffee.jpg",
    maximumParticipants: 25,
    daysAhead: 4,
    hour: 17,
  },
];

export const DEMO_ACCOUNT = {
  email: "demo@unimeet.app",
  password: "DemoUser123!",
  first_name: "Alex",
  last_name: "Popescu",
  username: "demo_alex",
  age: 21,
  profile_picture: "assets/images/avatars/demo_alex.svg",
  university: "Politehnica University of Timisoara",
  city: "Timisoara",
  bio: "Computer Science student always up for indie concerts, outdoor cinema, board games, hackathons, and specialty coffee.",
  interests: ["Indie Music", "Indie Cinema", "Board Games", "Coffee & City Walks", "Tech & Hackathons"],
  hobbies: ["Photography", "Board Games", "Specialty Coffee", "Hiking"],
  likedCategories: ["Concert", "Cinema", "Board Games", "Tech & Coding", "Campus Meetup"],
};

export const CONFIG = {
  DEMO_ACCOUNT,
  EVENT_CATEGORIES,
  CATEGORY_FALLBACK_IMAGES,
  GROUP_CATEGORIES,
  INTERESTS_CATALOG,
  SUGGESTED_HOBBIES,
  EVENT_IMAGE_PRESETS,
  REPORT_REASONS,
  SAMPLE_EVENTS_TEMPLATES,
};
