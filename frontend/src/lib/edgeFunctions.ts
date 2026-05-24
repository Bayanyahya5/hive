import { supabase } from './supabase';

const FUNCTION_NOT_FOUND_HINT =
  'Edge function not available. Run: npx supabase functions serve (in a separate terminal while supabase start is running).';

async function parseFunctionError(error: unknown): Promise<string> {
  const err = error as { message?: string; context?: Response };
  const ctx = err.context;

  if (ctx) {
    const text = await ctx.text().catch(() => '');
    if (text) {
      try {
        const payload = JSON.parse(text) as { error?: string; message?: string };
        if (payload.error) return payload.error;
        if (payload.message) return payload.message;
      } catch {
        if (text.includes('Function not found')) {
          return FUNCTION_NOT_FOUND_HINT;
        }
        return text;
      }
    }
  }

  if (err.message?.includes('Function not found')) {
    return FUNCTION_NOT_FOUND_HINT;
  }

  return err.message ?? 'Unknown error';
}

function isFunctionUnavailable(message: string): boolean {
  return (
    message.includes('Function not found') ||
    message.includes('Edge function not available') ||
    message.includes('Failed to send a request to the Edge Function')
  );
}

/** Same payload shape as the export-gdpr edge function. */
export async function exportGdprData(profileId: string) {
  const [profile, posts, classification, consentHistory] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', profileId).single(),
    supabase
      .from('posts')
      .select('content, created_at')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false }),
    supabase
      .from('classifications')
      .select('party, confidence, cluster_id, classified_at')
      .eq('profile_id', profileId)
      .maybeSingle(),
    supabase
      .from('consent_log')
      .select('scope, source, timestamp')
      .eq('profile_id', profileId)
      .order('timestamp', { ascending: false }),
  ]);

  if (profile.error) throw profile.error;

  return {
    generated_at: new Date().toISOString(),
    export_type: 'GDPR Article 15 - Right of Access',
    user_profile: profile.data,
    consent_history: consentHistory.data ?? [],
    synthetic_posts: posts.data ?? [],
    ai_analysis: classification.data ?? null,
    export_source: 'client_fallback',
  };
}

/** Cascade delete via profiles FK (same effect as delete-user edge function). */
export async function deleteProfileData(profileId: string) {
  const { error } = await supabase.from('profiles').delete().eq('id', profileId);
  if (error) throw error;
}

/**
 * Invoke an edge function with the logged-in user's JWT.
 * Falls back to direct Supabase queries when functions are not served locally.
 */
export async function invokeEdgeFunction<T = Record<string, unknown>>(
  name: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('You must be logged in. Please sign out and sign in again.');
  }

  const { data, error } = await supabase.functions.invoke(name, {
    ...(body ? { body } : {}),
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (error) {
    const message = await parseFunctionError(error);

    if (name === 'export-gdpr' && isFunctionUnavailable(message) && body?.target_profile_id) {
      return (await exportGdprData(String(body.target_profile_id))) as T;
    }

    if (name === 'delete-user' && isFunctionUnavailable(message) && body?.target_profile_id) {
      await deleteProfileData(String(body.target_profile_id));
      return { success: true, message: 'Deleted via client fallback.' } as T;
    }

    throw new Error(message);
  }

  if (data && typeof data === 'object' && 'error' in data && (data as { error: unknown }).error) {
    throw new Error(String((data as { error: string }).error));
  }

  return data as T;
}

/** GDPR export — tries edge function first, then client fallback. */
export async function exportUserGdpr(profileId: string) {
  try {
    return await invokeEdgeFunction<Record<string, unknown>>('export-gdpr', {
      target_profile_id: profileId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isFunctionUnavailable(message)) {
      return exportGdprData(profileId);
    }
    throw err;
  }
}

/** GDPR deletion — tries edge function first, then client fallback. */
export async function deleteUserGdpr(profileId: string) {
  try {
    await invokeEdgeFunction('delete-user', { target_profile_id: profileId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isFunctionUnavailable(message)) {
      await deleteProfileData(profileId);
      return;
    }
    throw err;
  }
}
