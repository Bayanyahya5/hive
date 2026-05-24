import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Your exact requested age distribution (30 total)
const targetAges = [
  ...Array(9).fill("18-24"),
  ...Array(6).fill("25-34"),
  ...Array(3).fill("35-44"),
  ...Array(2).fill("45-54"), 
  ...Array(10).fill("55+")
];

// Procedural demographic data based on your prompt rules
const demographics = [
  {
    names: ["Ahmad", "Fatima", "Tariq", "Layla", "Mahmoud"],
    cities: ["Nazareth", "Umm al-Fahm", "Rahat", "Sakhnin"],
    posts: [
      "The infrastructure in our city needs more funding immediately.",
      "Beautiful day spending time with family in the Galilee.",
      "We need true equality and better representation.",
      "Traffic on Route 65 was terrible today.",
      "Hoping for a peaceful future for all of us."
    ]
  },
  {
    names: ["Yosef", "Rivka", "Moshe", "Chaya", "Avraham"],
    cities: ["Bnei Brak", "Jerusalem", "Beit Shemesh", "Safed"],
    posts: [
      "Shabbat Shalom to everyone!",
      "Studying is the true foundation of our community.",
      "Concerned about the cost of living for large families right now.",
      "A wonderful community gathering last night.",
      "We must protect our traditions in the modern state."
    ]
  },
  {
    names: ["Omer", "Noa", "Ido", "Maya", "Amit"],
    cities: ["Tel Aviv", "Rishon LeZion", "Netanya", "Herzliya"],
    posts: [
      "Looking forward to the weekend at the beach.",
      "The tech sector is facing some tough challenges this quarter.",
      "Just trying to get through the week, the economy is crazy.",
      "Does anyone have recommendations for a good cafe in the center?",
      "Moderate voices need to be heard more in this country."
    ]
  }
];

async function finishSeeding() {
  console.log("Starting local generation for the final 30 profiles...");

  for (let i = 0; i < targetAges.length; i++) {
    // Pick a random demographic group and age
    const demo = demographics[i % 3]; 
    const randomName = demo.names[Math.floor(Math.random() * demo.names.length)];
    const randomCity = demo.cities[Math.floor(Math.random() * demo.cities.length)];
    const ageRange = targetAges[i];

    try {
      // 1. Insert Profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .insert({
          name: randomName,
          city: randomCity,
          age_range: ageRange
        })
        .select()
        .single();

      if (profileError) throw profileError;

      // 2. Insert Posts
      const postsToInsert = demo.posts.map(content => ({
        profile_id: profile.id,
        content: content
      }));

      const { error: postsError } = await supabase
        .from('posts')
        .insert(postsToInsert);

      if (postsError) throw postsError;

      // 3. Insert Consent Log
      const { error: consentError } = await supabase
        .from('consent_log')
        .insert({
          profile_id: profile.id,
          scope: 'Political discourse analysis',
          source: 'Synthetic Generation'
        });

      if (consentError) throw consentError;

      console.log(`Inserted profile ${i + 1}/30: ${randomName} (${ageRange}) from ${randomCity}`);

    } catch (error) {
      console.error(`Failed to insert profile ${i + 1}:`, error.message);
    }
  }

  console.log("Success! You now have exactly 200 profiles in your database.");
}

finishSeeding();