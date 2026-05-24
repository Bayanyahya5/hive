import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI, SchemaType } from "npm:@google/generative-ai";
import { requireAuthenticatedUser, createServiceClient } from "../_shared/auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 10;

function distance(v1: number[], v2: number[]) {
  return Math.sqrt(v1.reduce((sum, val, i) => sum + Math.pow(val - v2[i], 2), 0));
}

function kMeans(data: number[][], k: number, maxIterations = 100) {
  let centroids = data.slice(0, k);
  const assignments = new Array(data.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    for (let i = 0; i < data.length; i++) {
      let minDist = Infinity;
      let clusterIndex = 0;
      for (let j = 0; j < k; j++) {
        const dist = distance(data[i], centroids[j]);
        if (dist < minDist) {
          minDist = dist;
          clusterIndex = j;
        }
      }
      if (assignments[i] !== clusterIndex) {
        assignments[i] = clusterIndex;
        changed = true;
      }
    }

    if (!changed) break;

    const newCentroids = Array.from({ length: k }, () => new Array(data[0].length).fill(0));
    const counts = new Array(k).fill(0);

    for (let i = 0; i < data.length; i++) {
      const clusterIndex = assignments[i];
      for (let j = 0; j < data[i].length; j++) {
        newCentroids[clusterIndex][j] += data[i][j];
      }
      counts[clusterIndex]++;
    }

    for (let i = 0; i < k; i++) {
      if (counts[i] > 0) {
        for (let j = 0; j < newCentroids[i].length; j++) {
          newCentroids[i][j] /= counts[i];
        }
      } else {
        newCentroids[i] = data[Math.floor(Math.random() * data.length)];
      }
    }
    centroids = newCentroids;
  }
  return assignments;
}

async function extractKeywords(
  genAI: GoogleGenerativeAI,
  samplePosts: string[],
): Promise<string[]> {
  if (samplePosts.length === 0) return ["general", "discourse"];

  const keywordSchema = {
    type: SchemaType.OBJECT,
    properties: {
      keywords: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
      },
    },
    required: ["keywords"],
  };

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: keywordSchema,
      temperature: 0.2,
    },
  });

  const result = await model.generateContent(
    `Extract exactly 5 short theme keywords (single words or short phrases) from these synthetic social posts. Return JSON only.\n\nPosts:\n${JSON.stringify(samplePosts.slice(0, 8))}`,
  );

  const parsed = JSON.parse(result.response.text());
  const keywords = (parsed.keywords as string[] | undefined) ?? [];
  return keywords.slice(0, 5).map((k) => String(k).toLowerCase().trim()).filter(Boolean);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    await requireAuthenticatedUser(req);
    const supabase = createServiceClient();

    const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    const genAI = new GoogleGenerativeAI(geminiKey);
    const embedModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

    const { data: classifications, error: fetchError } = await supabase
      .from('classifications')
      .select('id, profile_id')
      .eq('party', 'unclear')
      .is('cluster_id', null);

    if (fetchError) throw fetchError;
    if (!classifications || classifications.length === 0) {
      return new Response(JSON.stringify({ message: "No unclear profiles need clustering." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const batchClassifications = classifications.slice(0, BATCH_SIZE);
    const profileIds = batchClassifications.map((c) => c.profile_id);

    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, posts(content)')
      .in('id', profileIds);

    if (profileError) throw profileError;
    if (!profiles || profiles.length === 0) {
      return new Response(JSON.stringify({ message: "No unclear profiles need clustering." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const embeddings: number[][] = [];
    for (const profile of profiles) {
      const combinedText = profile.posts.map((p: { content: string }) => p.content).join(" ");
      const result = await embedModel.embedContent(combinedText || "neutral post");
      embeddings.push(result.embedding.values);
      await new Promise((r) => setTimeout(r, 200));
    }

    const K = Math.min(3, profiles.length);
    const clusterAssignments = kMeans(embeddings, K);

    const groupedProfiles: Record<number, typeof profiles> = {};
    for (let i = 0; i < profiles.length; i++) {
      const clusterIndex = clusterAssignments[i];
      if (!groupedProfiles[clusterIndex]) groupedProfiles[clusterIndex] = [];
      groupedProfiles[clusterIndex].push(profiles[i]);
    }

    const clusterDbIds: Record<number, string> = {};

    for (let i = 0; i < K; i++) {
      const group = groupedProfiles[i] || [];
      if (group.length === 0) continue;

      const realSamples = group
        .flatMap((p) => p.posts.map((post: { content: string }) => post.content))
        .slice(0, 3);

      const topKeywords = await extractKeywords(genAI, realSamples);

      const { data: newCluster, error: clusterError } = await supabase
        .from('clusters')
        .insert({
          label: `Semantic Cluster ${i + 1}`,
          top_keywords: topKeywords,
          sample_posts: realSamples.length > 0 ? realSamples : ["No sample data available"],
        })
        .select()
        .single();

      if (clusterError) throw clusterError;
      clusterDbIds[i] = newCluster.id;
    }

    for (let i = 0; i < profiles.length; i++) {
      const assignedClusterDbId = clusterDbIds[clusterAssignments[i]];
      if (assignedClusterDbId) {
        await supabase
          .from('classifications')
          .update({ cluster_id: assignedClusterDbId })
          .eq('profile_id', profiles[i].id);
      }
    }

    const remaining = classifications.length - profiles.length;

    return new Response(JSON.stringify({
      success: true,
      processed: profiles.length,
      remaining,
      message: `Clustered ${profiles.length} unclear profile(s) using K-Means embeddings.${remaining > 0 ? ` ${remaining} still pending.` : ""}`,
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
