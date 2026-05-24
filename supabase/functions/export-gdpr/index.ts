import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    );

    const { target_profile_id } = await req.json();

    if (!target_profile_id) {
      throw new Error("Missing target_profile_id in request body.");
    }

    const [profile, posts, classification, consentHistory] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', target_profile_id).single(),
      supabase.from('posts').select('content, created_at').eq('profile_id', target_profile_id).order('created_at', { ascending: false }),
      supabase.from('classifications').select('party, confidence, cluster_id, classified_at').eq('profile_id', target_profile_id).maybeSingle(),
      supabase.from('consent_log').select('scope, source, timestamp').eq('profile_id', target_profile_id).order('timestamp', { ascending: false }),
    ]);

    if (profile.error) throw profile.error;

    const exportData = {
      generated_at: new Date().toISOString(),
      export_type: 'GDPR Article 15 - Right of Access',
      user_profile: profile.data,
      consent_history: consentHistory.data || [],
      synthetic_posts: posts.data || [],
      ai_analysis: classification.data || null,
    };

    return new Response(JSON.stringify(exportData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});