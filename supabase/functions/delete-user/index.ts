import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

    const { target_profile_id } = await req.json();

    if (!target_profile_id) {
      throw new Error("Missing target_profile_id in request body.");
    }

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
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" || message === "Missing Authorization header" ? 401 : 400;
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status,
    });
  }
});
