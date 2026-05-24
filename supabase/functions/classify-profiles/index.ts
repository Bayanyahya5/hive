import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI, SchemaType } from "npm:@google/generative-ai";
import { requireAuthenticatedUser, createServiceClient } from "../_shared/auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    await requireAuthenticatedUser(req);
    const supabase = createServiceClient();

    const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    const genAI = new GoogleGenerativeAI(geminiKey);

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

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-lite",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        temperature: 0.1,
      }
    });

    const { data: existingClassifications, error: existError } = await supabase
      .from('classifications')
      .select('profile_id');
      
    if (existError) throw existError;

    const classifiedIds = new Set(existingClassifications.map(c => c.profile_id));

    const { data: allProfiles, error: fetchError } = await supabase
      .from('profiles')
      .select('id, name, city, age_range, posts(content)');

    if (fetchError) throw fetchError;

    const unclassifiedProfiles = allProfiles
      .filter(p => !classifiedIds.has(p.id))
      .slice(0, 10); 

    if (unclassifiedProfiles.length === 0) {
      return new Response(JSON.stringify({ message: "No unclassified profiles found." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const safeProfilesForAI = unclassifiedProfiles.map((p, index) => ({
      index: index,
      city: p.city,
      age_range: p.age_range,
      posts: p.posts.map((post: { content: string }) => post.content)
    }));

    const prompt = `
      You are an expert political analyst in Israel. 
      Analyze the following user profiles and their recent social media posts.
      
      For each profile, classify their most likely political leaning based on their demographics (city, age) and post content into ONLY ONE of these exact categories:
      "Ra'am", "Hadash", "Balad", "Ta'al", "Jewish-sector party", or "unclear".
      Assign a confidence score between 0.0 and 1.0. If the posts are ambiguous, non-political, or moderate, classify as "unclear" with high confidence.

      Profiles to analyze:
      ${JSON.stringify(safeProfilesForAI)}
    `;

    const result = await model.generateContent(prompt);
    const aiData = JSON.parse(result.response.text());

    const mappedClassifications = aiData.classifications.map((aiResult: { index: number; party: string; confidence: number }) => ({
      profile_id: unclassifiedProfiles[aiResult.index].id,
      party: aiResult.party,
      confidence: Math.max(0, Math.min(1, aiResult.confidence))
    }));

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
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" || message === "Missing Authorization header" ? 401 : 500;
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status,
    });
  }
});
