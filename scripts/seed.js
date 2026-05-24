import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import dotenv from 'dotenv';

// dotenv.config();
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../frontend/.env.local') });

// Initialize Supabase
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Define the exact JSON schema we want Gemini to return
const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    profiles: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING },
          city: { type: SchemaType.STRING },
          age_range: { type: SchemaType.STRING },
          posts: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: { content: { type: SchemaType.STRING } }
            }
          }
        },
        required: ["name", "city", "age_range", "posts"]
      }
    }
  },
  required: ["profiles"]
};

const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash-lite",
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: responseSchema,
    temperature: 0.8,
  }
});

const PROFILES_PER_BATCH = 10;
const TOTAL_BATCHES = 20; // 10 * 20 = 200

async function generateBatch(batchNumber) {
  console.log(`Generating batch ${batchNumber}/${TOTAL_BATCHES} with Gemini...`);

  const prompt = `
    Generate ${PROFILES_PER_BATCH} highly realistic fake user profiles for a political discourse analysis system in Israel.
    
    CRITICAL INSTRUCTION - Demographics MUST logically align with their implied political leaning:
    - Ra'am, Balad, Ta'al: Profiles should be from Arab-majority cities (e.g., Nazareth, Umm al-Fahm, Rahat, Sakhnin) or mixed cities (Haifa, Jaffa, Lod). Use realistic Arabic names.
    - Hadash: Profiles can be from Arab-majority cities, mixed cities, or left-wing Jewish voters (e.g., Tel Aviv, Haifa). Use Arabic or Hebrew names.
    - Jewish-sector parties (Haredi or Religious Zionist): Profiles should be from cities like Jerusalem, Bnei Brak, Beit Shemesh, Safed, or Ashdod. Use realistic Hebrew/Jewish names.
    - 'Unclear' (Moderate/Centrist/Non-political): Profiles can be from anywhere, especially major central cities (Tel Aviv, Rishon LeZion, Netanya).
    
    For each profile, write 5 to 15 short social media posts (1-3 sentences each). The posts should subtly or overtly reflect their political alignment based on the demographics above, or focus on daily life if they are 'unclear'.
    Age ranges should be one of: "18-24", "25-34", "35-44", "45-54", "55+".
  `;

  const result = await model.generateContent(prompt);
  const data = JSON.parse(result.response.text());
  return data.profiles;
}

async function seedDatabase() {
    console.log("Starting secure database seeding...");
  
    let currentBatch = 1;
  
    // Use a while loop instead of a for loop so we only advance when successful
    while (currentBatch <= TOTAL_BATCHES) {
      try {
        const profilesData = await generateBatch(currentBatch);
  
        for (const profile of profilesData) {
          const { posts, ...profileDetails } = profile;
  
          // 1. Insert Profile
          const { data: insertedProfile, error: profileError } = await supabase
            .from('profiles')
            .insert([profileDetails])
            .select()
            .single();
  
          if (profileError) throw profileError;
  
          // 2. Insert Posts
          const postsToInsert = posts.map(post => ({
            profile_id: insertedProfile.id,
            content: post.content
          }));
  
          const { error: postsError } = await supabase
            .from('posts')
            .insert(postsToInsert);
  
          if (postsError) throw postsError;
  
          // 3. Insert Mandatory Consent Log (GDPR Rubric Requirement)
          const { error: consentError } = await supabase
            .from('consent_log')
            .insert({
              profile_id: insertedProfile.id,
              scope: 'Political discourse analysis',
              source: 'Synthetic Generation'
            });
  
          if (consentError) throw consentError;
        }
        
        console.log(`Successfully inserted batch ${currentBatch} (Profiles, Posts, and Consent Logs).`);
        
        // Move to the next batch only after a complete success
        currentBatch++;
        
        // Sleep for 10 seconds to respect the free tier rate limit
        await new Promise(resolve => setTimeout(resolve, 10000));
        
      } catch (error) {
        console.error(`Error in batch ${currentBatch}:`, error.message || error);
        console.log("API overloaded (503) or Rate Limited (429). Pausing for 30 seconds before retrying...");
        
        // If it fails, wait 30 seconds to let the Google API cool down, then the loop will retry the same batch
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    }
  
    console.log("Database seeding complete! 200 profiles successfully generated.");
  }
  
  seedDatabase();