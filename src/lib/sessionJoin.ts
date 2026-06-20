import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";

export type SessionJoinResult = {
  sessionId: string;
  role: "player1" | "player2";
  status: "waiting" | "active" | "ended" | string;
};

type SessionRow = {
  status?: string;
  player1_computer_id?: string | null;
  player2_computer_id?: string | null;
};

/** Join or reconnect to a session. Falls back to a direct table update if RPC fails. */
export async function ensureSessionJoined(sessionId: string, computerId: string): Promise<SessionJoinResult> {
  if (!isSupabaseConfigured) {
    return { sessionId, role: "player1", status: "waiting" };
  }

  const readSession = async () => {
    const { data, error } = await supabase
      .from("sessions")
      .select("status, player1_computer_id, player2_computer_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) throw error;
    return data as SessionRow | null;
  };

  try {
    const { data, error } = await supabase.rpc("join_session", {
      p_session_id: sessionId,
      p_computer_id: computerId,
    });
    if (!error && data) {
      const result = (Array.isArray(data) ? data[0] : data) as { session_id?: string; role?: "player1" | "player2" } | null;
      if (result?.role) {
        const row = await readSession();
        return {
          sessionId,
          role: result.role,
          status: row?.status ?? "waiting",
        };
      }
    }
  } catch {
    // fall through to direct join
  }

  let row = await readSession();
  if (!row) throw new Error("Session not found");

  const p1 = row.player1_computer_id;
  const p2 = row.player2_computer_id;

  if (p1 === computerId) {
    return { sessionId, role: "player1", status: row.status ?? "waiting" };
  }
  if (p2 === computerId) {
    return { sessionId, role: "player2", status: row.status ?? "waiting" };
  }

  if (row.status === "ended") throw new Error("Session already ended");

  // Direct join fallback (e.g. join_session RPC missing or broken).
  if (p2 == null && p1 != null && p1 !== computerId) {
    const { error: updateError } = await supabase
      .from("sessions")
      .update({
        player2_computer_id: computerId,
        status: "active",
        started_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("status", "waiting")
      .is("player2_computer_id", null);

    if (!updateError) {
      try {
        await supabase.from("session_state").upsert({ session_id: sessionId, last5_events: [] });
      } catch {
        // ignore
      }
      return { sessionId, role: "player2", status: "active" };
    }
  }

  row = await readSession();
  if (!row) throw new Error("Session not found");

  if (row.player2_computer_id === computerId) {
    return { sessionId, role: "player2", status: row.status ?? "active" };
  }
  if (row.player1_computer_id === computerId) {
    return { sessionId, role: "player1", status: row.status ?? "waiting" };
  }

  throw new Error("Session is full");
}

export async function fetchSessionStatus(sessionId: string): Promise<SessionRow | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase
    .from("sessions")
    .select("status, player1_computer_id, player2_computer_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return data as SessionRow | null;
}

export function isSessionReady(row: SessionRow | null): boolean {
  if (!row) return false;
  const p1 = row.player1_computer_id;
  const p2 = row.player2_computer_id;
  return row.status === "active" && Boolean(p1) && Boolean(p2) && p1 !== p2;
}

export function hasBothPlayers(row: SessionRow | null): boolean {
  if (!row) return false;
  const p1 = row.player1_computer_id;
  const p2 = row.player2_computer_id;
  return Boolean(p1) && Boolean(p2) && p1 !== p2;
}

type LobbyResult = { session_id: string; role: "player1" | "player2" };

/** Create an invite-only lobby (never auto-joins a stranger's session). */
export async function createInviteLobby(computerId: string): Promise<{ sessionId: string; role: "player1" | "player2" }> {
  if (!isSupabaseConfigured) {
    const sessionId = crypto.randomUUID();
    return { sessionId, role: "player1" };
  }

  try {
    const { data, error } = await supabase.rpc("create_lobby", { p_computer_id: computerId });
    if (!error && data) {
      const result = (Array.isArray(data) ? data[0] : data) as LobbyResult | null;
      if (result?.session_id && result.role) {
        return { sessionId: result.session_id, role: result.role };
      }
    }
  } catch {
    // fall through
  }

  const { data: existing } = await supabase
    .from("sessions")
    .select("id")
    .eq("status", "waiting")
    .eq("player1_computer_id", computerId)
    .is("player2_computer_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return { sessionId: existing.id as string, role: "player1" };
  }

  const { data: created, error: insertError } = await supabase
    .from("sessions")
    .insert({ status: "waiting", player1_computer_id: computerId })
    .select("id")
    .single();

  if (insertError || !created?.id) {
    throw new Error("Failed to create lobby");
  }

  const sessionId = created.id as string;
  try {
    await supabase.from("session_state").upsert({ session_id: sessionId, last5_events: [] });
  } catch {
    // ignore
  }

  return { sessionId, role: "player1" };
}
