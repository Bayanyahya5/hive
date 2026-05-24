import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- K-MEANS ALGORITHM HELPERS ---
// Calculate Euclidean distance between two vectors
function distance(v1: number[], v2: number[]) {
  return Math.sqrt(v1.reduce((sum, val, i) => sum + Math.pow(val - v2[i], 2), 0));
}

// Pure K-Means implementation
function kMeans(data: number[][], k: number, maxIterations = 100) {
  let centroids = data.slice(0, k); // Init with first K points
  let assignments = new Array(data.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    // Assign points to nearest centroid
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

    if (!changed) break; // Stop if stabilized

    // Recalculate centroids
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
        newCentroids[i] = data[Math.floor(Math.random() * data.length)]; // Handle empty cluster
      }
    }
    centroids = newCentroids;
  }
  return assignments;
}
// ---------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    const genAI = new GoogleGenerativeAI(geminiKey);
    // Use the embedding model, not the text generation model
    const embedModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

    // 1. Fetch "unclear" profiles that haven't been clustered
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

    const profileIds = classifications.map(c => c.profile_id);
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, posts(content)')
      .in('id', profileIds);

    if (profileError) throw profileError;

    // 2. Generate Embeddings for each user's combined posts
    console.log(`Generating embeddings for ${profiles.length} profiles...`);
    const embeddings: number[][] = [];
    
    for (const profile of profiles) {
      // Combine all posts into one string representing the user's "voice"
      const combinedText = profile.posts.map((p: any) => p.content).join(" ");
      const result = await embedModel.embedContent(combinedText);
      embeddings.push(result.embedding.values);
      // Small delay to respect rate limits
      await new Promise(r => setTimeout(r, 200)); 
    }

    // 3. Run K-Means Clustering
    console.log("Running K-Means algorithm...");
    const K = Math.min(3, profiles.length); // Prevent crashing if there are fewer than 3 unclear profiles
    const clusterAssignments = kMeans(embeddings, K);

// 4. Group profiles by their new assigned mathematical clusters
const groupedProfiles: { [key: number]: any[] } = {};
for (let i = 0; i < profiles.length; i++) {
  const clusterIndex = clusterAssignments[i];
  if (!groupedProfiles[clusterIndex]) groupedProfiles[clusterIndex] = [];
  groupedProfiles[clusterIndex].push(profiles[i]);
}

const clusterDbIds: { [key: number]: string } = {};

// 5. Create Dynamic Clusters in the Database
for (let i = 0; i < K; i++) {
  const group = groupedProfiles[i] || [];
  if (group.length === 0) continue; 

  // Extract real sample posts from the users in this specific cluster
  const realSamples = group
    .flatMap(p => p.posts.map((post: any) => post.content))
    .slice(0, 3); // Take the first 3 posts as samples

  const { data: newCluster, error: clusterError } = await supabase
    .from('clusters')
    .insert({
      label: `Semantic Cluster ${i + 1}`,
      top_keywords: ["economy", "daily-life", "moderate"], // General themes for unclear users
      sample_posts: realSamples.length > 0 ? realSamples : ["No sample data available"]
    })
    .select()
    .single();
    
  if (clusterError) throw clusterError;
  clusterDbIds[i] = newCluster.id;
}

// 6. Save the cluster IDs to the specific user's classifications
console.log("Saving assignments to database...");
for (let i = 0; i < profiles.length; i++) {
  const assignedClusterDbId = clusterDbIds[clusterAssignments[i]];
  
  if (assignedClusterDbId) {
    await supabase
      .from('classifications')
      .update({ cluster_id: assignedClusterDbId })
      .eq('profile_id', profiles[i].id);
  }
}

return new Response(JSON.stringify({ 
  success: true, 
  message: `Successfully clustered ${profiles.length} profiles using K-Means embeddings.` 
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