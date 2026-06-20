import GameScreen from "@/components/GameScreen";
import { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useGame, CONTOUR_LIBRARY } from "@/lib/gameContext";
import { useComputerId } from "@/hooks/useComputerId";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { ensureSessionJoined } from "@/lib/sessionJoin";

const IN_GAME_PHASES = new Set(["countdown", "draw", "scoring", "roundResult", "finalResults", "matchmaking"]);

/** Joins /session/:id once on load. Must never re-run mid-round (that restarted the game). */
export function SessionBootstrap() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { computerId } = useComputerId({ enabled: Boolean(sessionId) });
  const game = useGame();
  const bootstrappedRef = useRef<string | null>(null);
  const gameRef = useRef(game);
  gameRef.current = game;

  useEffect(() => {
    bootstrappedRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    const live = gameRef.current;
    if (bootstrappedRef.current === sessionId) return;

    if (live.multiplayerSessionId === sessionId && live.mode === "multiplayer" && IN_GAME_PHASES.has(live.phase)) {
      bootstrappedRef.current = sessionId;
      return;
    }

    const { enterMatchmakingLobby, hydrateMultiplayer, setMultiplayerSession } = gameRef.current;

    const hydrateFromSnapshot = async (role: "player1" | "player2", status: string) => {
      const midGame = gameRef.current;
      if (
        midGame.multiplayerSessionId === sessionId &&
        midGame.mode === "multiplayer" &&
        IN_GAME_PHASES.has(midGame.phase) &&
        midGame.phase !== "matchmaking"
      ) {
        bootstrappedRef.current = sessionId;
        return;
      }

      localStorage.setItem("contour_last_session_id", sessionId);
      localStorage.setItem("contour_last_session_role", role);

      setMultiplayerSession(sessionId, role);
      const raw = localStorage.getItem(`contour_mp_state:${sessionId}`);
      let snap = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;

      try {
        const { data: rr } = await supabase
          .from("session_rounds")
          .select("round,prompt_id,score,drawing_data_url")
          .eq("session_id", sessionId)
          .eq("computer_id", computerId)
          .order("round", { ascending: true });

        if (Array.isArray(rr) && rr.length > 0) {
          if (!snap) snap = {};
          const results = rr
            .filter((r: { round?: number | null }) => r.round != null)
            .map((r: { round: number; prompt_id: string; score?: number | null; drawing_data_url?: string | null }) => {
              const prompt = CONTOUR_LIBRARY.find((p) => p.id === r.prompt_id);
              return {
                round: r.round,
                promptId: r.prompt_id,
                promptTitle: prompt?.title ?? r.prompt_id,
                score: Number(r.score ?? 0),
                drawingDataUrl: r.drawing_data_url ?? "",
                originalSrc: prompt?.src ?? "",
              };
            });
          snap.results = results;
          snap.currentRound = Math.min(results.length + 1, (snap.totalRounds as number | undefined) ?? 4);
        }
      } catch {
        // ignore
      }

      const afterFetch = gameRef.current;
      if (
        afterFetch.multiplayerSessionId === sessionId &&
        afterFetch.mode === "multiplayer" &&
        IN_GAME_PHASES.has(afterFetch.phase) &&
        afterFetch.phase !== "matchmaking"
      ) {
        bootstrappedRef.current = sessionId;
        return;
      }

      if (status === "waiting") {
        enterMatchmakingLobby(sessionId, role);
        bootstrappedRef.current = sessionId;
        return;
      }

      const hasProgress =
        (Array.isArray(snap?.results) && (snap.results as unknown[]).length > 0) ||
        (typeof snap?.currentRound === "number" && snap.currentRound > 1);

      if (hasProgress) {
        hydrateMultiplayer(sessionId, role, snap);
      } else {
        // Both players must be in the session before the game starts — stay in lobby.
        enterMatchmakingLobby(sessionId, role);
      }

      bootstrappedRef.current = sessionId;
    };

    let cancelled = false;

    const run = async () => {
      if (!isSupabaseConfigured) {
        setMultiplayerSession(sessionId, "player1");
        const raw = localStorage.getItem(`contour_mp_state:${sessionId}`);
        const snap = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
        if (snap?.results && Array.isArray(snap.results) && snap.results.length > 0) {
          hydrateMultiplayer(sessionId, "player1", snap);
        } else if (gameRef.current.phase === "idle") {
          enterMatchmakingLobby(sessionId, "player1");
        }
        bootstrappedRef.current = sessionId;
        return;
      }

      try {
        const joined = await ensureSessionJoined(sessionId, computerId);
        if (cancelled) return;
        await hydrateFromSnapshot(joined.role, joined.status);
      } catch {
        if (cancelled) return;
        if (gameRef.current.phase === "idle") {
          enterMatchmakingLobby(sessionId, "player1");
        }
        bootstrappedRef.current = sessionId;
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [sessionId, computerId]);

  return null;
}

export default function GameLayout() {
  const { sessionId } = useParams<{ sessionId?: string }>();

  return (
    <>
      {sessionId ? <SessionBootstrap /> : null}
      <GameScreen />
    </>
  );
}
