import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 25;
const MAX_KEYWORDS = 5;
const MAX_SAMPLE_POSTS = 3;

// ─── Text utilities ───────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\sא-ת]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function buildVocabulary(tokenizedDocs: string[][]): string[] {
  return Array.from(new Set(tokenizedDocs.flat()));
}

/** TF-IDF document embedding: one numeric vector per profile (sparse → dense array). */
function computeDocumentEmbeddings(tokenizedDocs: string[][]): number[][] {
  const vocab = buildVocabulary(tokenizedDocs);
  const N = tokenizedDocs.length;
  if (N === 0 || vocab.length === 0) return [];

  const df: Record<string, number> = {};
  for (const word of vocab) {
    df[word] = tokenizedDocs.filter((doc) => doc.includes(word)).length;
  }

  const raw = tokenizedDocs.map((doc) => {
    const tf: Record<string, number> = {};
    for (const word of doc) tf[word] = (tf[word] || 0) + 1;
    return vocab.map((word) => {
      const termFreq = tf[word] || 0;
      if (termFreq === 0) return 0;
      const idf = Math.log((N + 1) / (df[word] + 1)) + 1;
      return termFreq * idf;
    });
  });

  return raw.map(l2Normalize);
}

function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

function euclidean(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
}

/** k-means on embedding vectors (assignment: embedding-based + k-means). */
function kMeans(embeddings: number[][], k: number, maxIter = 100): number[] {
  const n = embeddings.length;
  const dim = embeddings[0]?.length ?? 0;
  if (n === 0 || dim === 0) return [];
  if (k >= n) return embeddings.map((_, i) => i);

  // k-means++ style: spread initial centroids
  const centroids: number[][] = [embeddings[0].slice()];
  while (centroids.length < k) {
    const dists = embeddings.map((e) =>
      Math.min(...centroids.map((c) => euclidean(e, c)))
    );
    const total = dists.reduce((a, b) => a + b, 0) || 1;
    let r = Math.random() * total;
    let pick = 0;
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i];
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    centroids.push(embeddings[pick].slice());
  }

  let assignments = new Array(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const d = euclidean(embeddings[i], centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed = true;
      }
    }
    if (!changed) break;

    const sums = Array.from({ length: k }, () => new Array(dim).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let j = 0; j < dim; j++) sums[c][j] += embeddings[i][j];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        centroids[c] = l2Normalize(sums[c].map((v) => v / counts[c]));
      }
    }
  }

  return assignments;
}

function extractTopKeywords(texts: string[], topN = MAX_KEYWORDS): string[] {
  const tokenized = texts.map(tokenize).filter((d) => d.length > 0);
  if (tokenized.length === 0) return [];

  const vocab = buildVocabulary(tokenized);
  const N = tokenized.length;
  const scores: Record<string, number> = {};

  for (const word of vocab) {
    const df = tokenized.filter((d) => d.includes(word)).length;
    let score = 0;
    for (const doc of tokenized) {
      const tf = doc.filter((w) => w === word).length;
      if (tf > 0) score += tf * Math.log((N + 1) / (df + 1));
    }
    scores[word] = score;
  }

  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([w]) => w);
}

type ProfileRow = { id: string; posts: { content: string }[] };

// ─── Edge Function ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? ""
    );

    const { data: pending, error: fetchError } = await supabase
      .from("classifications")
      .select("profile_id")
      .eq("party", "unclear")
      .is("cluster_id", null)
      .limit(BATCH_SIZE);

    if (fetchError) throw fetchError;
    if (!pending?.length) {
      return new Response(
        JSON.stringify({ message: "No unclear profiles need clustering." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const profileIds = pending.map((r) => r.profile_id);
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, posts(content)")
      .in("id", profileIds);

    if (profileError) throw profileError;
    if (!profiles?.length) throw new Error("No profile rows returned for unclear IDs.");

    const rows = profiles as ProfileRow[];

    const documents = rows.map((p) =>
      (p.posts ?? []).map((post) => post.content).join(" ").trim() || "no content"
    );
    const tokenizedDocs = documents.map(tokenize);

    // Step 1: Build embedding vectors (TF-IDF, L2-normalized)
    const embeddings = computeDocumentEmbeddings(tokenizedDocs);
    if (embeddings.length === 0) {
      throw new Error("Could not build document embeddings from post text.");
    }

    // Step 2: k-means on embeddings
    const n = embeddings.length;
    const k = Math.max(1, Math.min(3, n));
    const assignments = k === 1 ? [0] : kMeans(embeddings, k);

    const groups: ProfileRow[][] = Array.from({ length: k }, () => []);
    for (let i = 0; i < rows.length; i++) {
      groups[assignments[i]].push(rows[i]);
    }

    const clusterIdByIndex: Record<number, string> = {};

    for (let clusterIndex = 0; clusterIndex < k; clusterIndex++) {
      const group = groups[clusterIndex];
      if (group.length === 0) continue;

      const allTexts = group.flatMap((p) =>
        (p.posts ?? []).map((post) => post.content)
      );
      const keywords = extractTopKeywords(allTexts, MAX_KEYWORDS);
      const label =
        keywords.length > 0
          ? `Cluster: ${keywords.slice(0, 3).join(", ")}`
          : `Unclear group ${clusterIndex + 1}`;

      const samplePosts = allTexts
        .filter((t) => t.trim().length > 0)
        .slice(0, MAX_SAMPLE_POSTS);

      const { data: clusterRow, error: clusterError } = await supabase
        .from("clusters")
        .insert({
          label,
          top_keywords: keywords.length > 0 ? keywords : ["unclear", "mixed"],
          sample_posts:
            samplePosts.length > 0 ? samplePosts : ["No sample posts available"],
        })
        .select("id")
        .single();

      if (clusterError) throw clusterError;
      clusterIdByIndex[clusterIndex] = clusterRow.id;
    }

    for (let i = 0; i < rows.length; i++) {
      const clusterDbId = clusterIdByIndex[assignments[i]];
      if (!clusterDbId) continue;

      const { error: updateError } = await supabase
        .from("classifications")
        .update({ cluster_id: clusterDbId })
        .eq("profile_id", rows[i].id);

      if (updateError) throw updateError;
    }

    const remaining = pending.length === BATCH_SIZE;

    return new Response(
      JSON.stringify({
        success: true,
        processed: rows.length,
        clusters_created: Object.keys(clusterIdByIndex).length,
        method: "tfidf-document-embeddings + k-means",
        message: remaining
          ? `Clustered ${rows.length} unclear profiles (batch). Run pipeline again if more remain.`
          : `Clustered ${rows.length} unclear profiles using TF-IDF embeddings and k-means.`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    console.error("cluster-profiles error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});