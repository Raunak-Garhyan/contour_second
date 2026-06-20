import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { useComputerId } from "@/hooks/useComputerId";
import { useGame } from "@/lib/gameContext";
import { useNavigate, useParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Copy, Share2, Users } from "lucide-react";
import { createInviteLobby, fetchSessionStatus, hasBothPlayers, isSessionReady } from "@/lib/sessionJoin";

type SessionUpdatePayload = {
  new?: {
    status?: string | null;
    player2_computer_id?: string | null;
  };
};

export default function Matchmaking() {
  const {
    enterMatchmakingLobby,
    beginMultiplayer,
    resetGame,
    matchmakingRequestId,
    multiplayerSessionId,
    multiplayerRole,
    phase,
  } = useGame();
  const { sessionId: urlSessionId } = useParams<{ sessionId?: string }>();
  const { computerId } = useComputerId({ enabled: true });
  const navigate = useNavigate();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [bothPlayersPresent, setBothPlayersPresent] = useState(false);
  const handledRequestRef = useRef(new Set<number>());
  const lobbyChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const startedGameRef = useRef(false);

  const sessionId = urlSessionId ?? multiplayerSessionId;
  const sessionUrl = sessionId ? `${window.location.origin}/session/${sessionId}` : null;
  const isLobbyHost = multiplayerRole === "player1";

  const startGameForSession = useCallback(
    (id: string) => {
      if (startedGameRef.current) return;
      if (phase !== "matchmaking") return;
      startedGameRef.current = true;
      setBothPlayersPresent(true);
      beginMultiplayer(id);
    },
    [beginMultiplayer, phase]
  );

  // Create invite lobby when MULTI is clicked (no auto-join with strangers).
  useEffect(() => {
    if (urlSessionId) return;
    if (matchmakingRequestId == null) return;
    if (handledRequestRef.current.has(matchmakingRequestId)) return;
    handledRequestRef.current.add(matchmakingRequestId);

    if (!isSupabaseConfigured) {
      setError("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env");
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const result = await createInviteLobby(computerId);
        if (cancelled) return;

        localStorage.setItem("contour_last_session_id", result.sessionId);
        localStorage.setItem("contour_last_session_role", result.role);

        enterMatchmakingLobby(result.sessionId, result.role === "player2" ? "player2" : "player1");
        navigate(`/session/${result.sessionId}`, { replace: true });
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to create lobby");
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [computerId, enterMatchmakingLobby, navigate, matchmakingRequestId, urlSessionId]);

  // Wait until both players are in the same session, then start together.
  useEffect(() => {
    if (!sessionId || !isSupabaseConfigured || phase !== "matchmaking") return;

    if (urlSessionId !== sessionId) {
      navigate(`/session/${sessionId}`, { replace: true });
    }

    let cancelled = false;

    const cleanupChannel = async () => {
      if (lobbyChannelRef.current) {
        try {
          await supabase.removeChannel(lobbyChannelRef.current);
        } catch {
          // ignore
        }
        lobbyChannelRef.current = null;
      }
    };

    const checkAndStart = async () => {
      try {
        const row = await fetchSessionStatus(sessionId);
        if (cancelled || startedGameRef.current) return;

        if (hasBothPlayers(row)) {
          setBothPlayersPresent(true);
        }

        if (isSessionReady(row)) {
          startGameForSession(sessionId);
        }
      } catch {
        // ignore transient poll errors
      }
    };

    const setup = async () => {
      await checkAndStart();
      if (cancelled || startedGameRef.current) return;

      await cleanupChannel();
      lobbyChannelRef.current = supabase
        .channel(`lobby:${sessionId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "sessions", filter: `id=eq.${sessionId}` },
          (payload) => {
            const next = (payload as SessionUpdatePayload).new;
            if (cancelled || startedGameRef.current) return;
            if (next?.player2_computer_id) {
              setBothPlayersPresent(true);
            }
            if (next?.status === "active" && next?.player2_computer_id) {
              startGameForSession(sessionId);
            }
          }
        )
        .subscribe();
    };

    void setup();
    const pollTimer = window.setInterval(() => {
      void checkAndStart();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
      void cleanupChannel();
    };
  }, [sessionId, urlSessionId, phase, navigate, startGameForSession]);

  useEffect(() => {
    if (phase === "matchmaking") {
      startedGameRef.current = false;
      setBothPlayersPresent(false);
    }
  }, [sessionId, phase]);

  const copyInviteLink = async () => {
    if (!sessionUrl) return;
    try {
      await navigator.clipboard.writeText(sessionUrl);
      toast({
        title: "Link copied",
        description: "Send it to your friend so they can join.",
      });
    } catch {
      toast({
        title: "Copy failed",
        description: "Your browser blocked clipboard access.",
      });
    }
  };

  const shareInviteLink = async () => {
    if (!sessionUrl) return;
    const message = `Join my Contour session: ${sessionUrl}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "Contour multiplayer invite",
          text: message,
          url: sessionUrl,
        });
        return;
      }
    } catch {
      // user cancelled or share unavailable
    }

    try {
      await navigator.clipboard.writeText(message);
      toast({
        title: "Invite copied",
        description: "Paste it in messages or any app.",
      });
    } catch {
      toast({
        title: "Share failed",
        description: "Use Copy Link instead.",
      });
    }
  };

  const handleCancel = () => {
    resetGame();
    navigate("/", { replace: true });
  };

  const heading = bothPlayersPresent
    ? "STARTING..."
    : isLobbyHost
      ? "INVITE FRIEND"
      : "JOINED";

  const subtext = bothPlayersPresent
    ? "Both players are in. Starting game..."
    : isLobbyHost
      ? "Share the link below. The game won't start until your friend opens it."
      : "You're in the session. Waiting for the host — game starts when both players are here.";

  return (
    <div className="w-full h-full flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-xl p-10 bg-black border-4 border-white hard-shadow"
      >
        <div className="flex items-center justify-between gap-6">
          <div>
            <div className="text-white font-display font-black uppercase tracking-[0.25em] text-xs opacity-70">
              Multiplayer
            </div>
            <h2 className="mt-2 text-white font-display font-black text-4xl tracking-tight">{heading}</h2>
          </div>

          <div className="w-12 h-12 border-4 border-white flex items-center justify-center" aria-hidden>
            <Users size={22} className="text-white" />
          </div>
        </div>

        {error ? (
          <div className="mt-8 border-2 border-white/30 p-4 text-white/80 font-display font-bold uppercase tracking-widest text-[10px]">
            {error}
          </div>
        ) : (
          <div className="mt-8 text-white/70 font-display font-bold uppercase tracking-widest text-[10px] leading-relaxed">
            {subtext}
          </div>
        )}

        {sessionUrl && isLobbyHost && !bothPlayersPresent && (
          <div className="mt-8 border-2 border-white/20 bg-white/[0.04] p-4">
            <div className="text-white/50 font-display font-bold uppercase tracking-[0.35em] text-[9px]">
              Session Link
            </div>
            <div className="mt-2 break-all text-white font-display font-black uppercase tracking-widest text-[10px] leading-relaxed">
              {sessionUrl}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <motion.button
                whileTap={{ x: 2, y: 2, boxShadow: "0px 0px 0px 0px rgba(255,255,255,1)" }}
                whileHover={{ x: -2, y: -2, boxShadow: "4px 4px 0px 0px rgba(255,255,255,1)" }}
                onClick={shareInviteLink}
                className="h-11 px-4 border-2 border-white bg-white text-black font-display font-black uppercase tracking-widest transition-all inline-flex items-center gap-2"
              >
                <Share2 size={16} />
                Invite Friend
              </motion.button>
              <motion.button
                whileTap={{ x: 2, y: 2, boxShadow: "0px 0px 0px 0px rgba(255,255,255,1)" }}
                whileHover={{ x: -2, y: -2, boxShadow: "4px 4px 0px 0px rgba(255,255,255,1)" }}
                onClick={copyInviteLink}
                className="h-11 px-4 border-2 border-white text-white font-display font-black uppercase tracking-widest hover:bg-white hover:text-black transition-all inline-flex items-center gap-2"
              >
                <Copy size={16} />
                Copy Link
              </motion.button>
            </div>
          </div>
        )}

        {!isLobbyHost && sessionUrl && !bothPlayersPresent && (
          <div className="mt-8 border-2 border-white/20 bg-white/[0.04] p-4">
            <div className="text-white/50 font-display font-bold uppercase tracking-[0.35em] text-[9px]">
              Session
            </div>
            <div className="mt-2 break-all text-white/60 font-display font-bold uppercase tracking-widest text-[10px]">
              {sessionUrl}
            </div>
          </div>
        )}

        <div className="mt-10 flex items-center justify-between gap-4">
          <motion.button
            whileTap={{ x: 2, y: 2, boxShadow: "0px 0px 0px 0px rgba(255,255,255,1)" }}
            whileHover={{ x: -2, y: -2, boxShadow: "4px 4px 0px 0px rgba(255,255,255,1)" }}
            onClick={handleCancel}
            className="h-12 px-6 border-2 border-white text-white font-display font-black uppercase tracking-widest hover:bg-white hover:text-black transition-all"
          >
            Cancel
          </motion.button>

          <div className="text-white/40 font-display font-bold uppercase tracking-widest text-[9px] text-right">
            {sessionId ? `Session ${sessionId.slice(0, 8)}…` : ""}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
