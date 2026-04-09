import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://rdjuvpodvbvyylsbelbp.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkanV2cG9kdmJ2eXlsc2JlbGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2ODMzMDgsImV4cCI6MjA5MTI1OTMwOH0.DNSQ6-FOaN7iXOKNP20ns1w44NHlZkjupRG9dYgRJvQ";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Validate a Supabase access token passed from the dashboard.
 * Returns the user if valid, null otherwise.
 */
export async function validateToken(accessToken: string) {
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return data.user;
}

export const DASHBOARD_URL = "https://breath-protocol.vercel.app";
