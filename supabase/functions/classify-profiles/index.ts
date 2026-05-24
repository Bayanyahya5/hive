import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { GoogleGenerativeAI, SchemaType } from "npm:@google/generative-ai";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    // Make sure this matches your .env file exactly!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    const genAI = new GoogleGenerativeAI(geminiKey);

    // Strict JSON schema: Enforces EXACT string matching for your SQL constraints
    const responseSchema = {
      type: SchemaType.OBJECT,
      properties: {
        classifications: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              index: { type: SchemaType.INTEGER },
              party: { 
                type: SchemaType.STRING,
                enum: ["Ra'am", "Hadash", "Balad", "Ta'al", "Jewish-sector party", "unclear"]
              },
              confidence: { type: SchemaType.NUMBER }
            },
            required: ["index", "party", "confidence"]
          }
        }
      },
      required: ["classifications"]
    };

    // Swapped to flash-lite for massive API rate limit protection
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-lite",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        temperature: 0.1, // Keep it highly analytical
      }
    });

    // 1. Fetch unclassified profiles
    const { data: existingClassifications, error: existError } = await supabase
      .from('classifications')
      .select('profile_id');
      
    if (existError) throw existError;

    const classifiedIds = new Set(existingClassifications.map(c => c.profile_id));

    // Include age_range to give the AI better context
    const { data: allProfiles, error: fetchError } = await supabase
      .from('profiles')
      .select('id, name, city, age_range, posts(content)');

    if (fetchError) throw fetchError;

    // Process in batches of 10 to balance speed and Edge Function timeouts
    const unclassifiedProfiles = allProfiles
      .filter(p => !classifiedIds.has(p.id))
      .slice(0, 10); 

    if (unclassifiedProfiles.length === 0) {
      return new Response(JSON.stringify({ message: "No unclassified profiles found." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // 2. Strip UUIDs and map to simple integers for AI safety
    const safeProfilesForAI = unclassifiedProfiles.map((p, index) => ({
      index: index,
      city: p.city,
      age_range: p.age_range,
      posts: p.posts.map((post: any) => post.content)
    }));

    // 3. Real AI Prompt
    const prompt = `
      You are an expert political analyst in Israel. 
      Analyze the following user profiles and their recent social media posts.
      
      For each profile, classify their most likely political leaning based on their demographics (city, age) and post content into ONLY ONE of these exact categories:
      "Ra'am", "Hadash", "Balad", "Ta'al", "Jewish-sector party", or "unclear".
      Assign a confidence score between 0.0 and 1.0. If the posts are ambiguous, non-political, or moderate, classify as "unclear" with high confidence.

      Profiles to analyze:
      ${JSON.stringify(safeProfilesForAI)}
    `;

    // 4. Execute real Gemini call
    const result = await model.generateContent(prompt);
    const aiData = JSON.parse(result.response.text());

    // 5. Re-map integers back to real database UUIDs
    const mappedClassifications = aiData.classifications.map((aiResult: any) => ({
      profile_id: unclassifiedProfiles[aiResult.index].id,
      party: aiResult.party,
      // Clamp confidence mathematically to guarantee it never violates the SQL CHECK >=0 AND <=1
      confidence: Math.max(0, Math.min(1, aiResult.confidence))
    }));

    // 6. Save to database
    const { error: insertError } = await supabase
      .from('classifications')
      .insert(mappedClassifications);

    if (insertError) throw insertError;

    return new Response(JSON.stringify({ 
      success: true, 
      processed: mappedClassifications.length,
      message: "Successfully classified using Gemini API."
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Function error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});