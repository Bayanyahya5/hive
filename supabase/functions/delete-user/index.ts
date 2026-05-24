import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests for React
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

    console.log(`Executing GDPR Right to Deletion for profile: ${target_profile_id}`);

    // Because of ON DELETE CASCADE, deleting the profile automatically 
    // deletes their posts, classifications, and consent_log!
    const { error: deleteError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', target_profile_id);

    if (deleteError) throw deleteError;

    return new Response(JSON.stringify({ 
      success: true, 
      message: "User and all associated data completely wiped." 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Deletion Failed:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});