import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";

type CursorPayload = { x: number; y: number; tool?: string; ts: number };

type MultiplayerMessage =
  | { type: "hello"; clientId: string; ts: number }
  | { type: "cursor"; clientId: string; ts: number; payload: CursorPayload }
  | { type: "round_state"; clientId: string; ts: number; round: number; phase: string }
  | { type: "preview"; clientId: string; ts: number; round: number; dataUrl: string }
  | { type: "stroke_point"; clientId: string; ts: number; round: number; by: string; x: number; y: number }
  | { type: "sync_request"; clientId: string; ts: number; round: number }
  | { type: "sync_response"; clientId: string; ts: number; round: number; by: string; points: Array<[number, number]> }
  | { type: "score"; clientId: string; ts: number; round: number; totalScore: number };

function safeNow() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function randomId() {
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

type UseMultiplayerOpts = {
  enabled?: boolean;
  sessionId?: string | null;
  computerId?: string | null;
  round?: number;
};

export function useMultiplayerChannel(opts?: UseMultiplayerOpts) {
  const enabled = opts?.enabled ?? true;
  const sessionId = opts?.sessionId ?? null;
  const computerId = opts?.computerId ?? null;
  const round = opts?.round ?? 1;

  const clientId = useMemo(() => randomId(), []);
  const [opponentId, setOpponentId] = useState<string | null>(null);
  const [opponentPreview, setOpponentPreview] = useState<string | null>(null);
  const [opponentRound, setOpponentRound] = useState<number | null>(null);
  const [opponentTotalScore, setOpponentTotalScore] = useState<number | null>(null);
  const [opponentScoreRound, setOpponentScoreRound] = useState<number | null>(null);
  const [opponentCursor, setOpponentCursor] = useState<CursorPayload | null>(null);
  const [opponentCursorTrail, setOpponentCursorTrail] = useState<Array<[number, number]>>([]);
  const [opponentStrokePoints, setOpponentStrokePoints] = useState<Array<[number, number]>>([]);
  const [opponentRoundState, setOpponentRoundState] = useState<{ round: number; phase: string } | null>(null);

  // Fallback: BroadcastChannel when Supabase isn't configured
  const bcRef = useRef<BroadcastChannel | null>(null);
  const lastPreviewSentAtRef = useRef(0);
  const lastCursorSentAtRef = useRef(0);
  const lastStrokeSentAtRef = useRef(0);

  const realtimeRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const pendingEventsRef = useRef<any[]>([]);

  const persistEvents = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    if (!sessionId || !computerId) return;
    const pending = pendingEventsRef.current;
    if (pending.length === 0) return;
    pendingEventsRef.current = [];

    try {
      const { data } = await supabase
        .from("session_state")
        .select("last5_events")
        .eq("session_id", sessionId)
        .maybeSingle();
      const existing = Array.isArray((data as any)?.last5_events) ? (data as any).last5_events : [];
      const merged = [...existing, ...pending].slice(-5);
      await supabase.from("session_state").upsert({ session_id: sessionId, last5_events: merged });
    } catch {
      // ignore
    }
  }, [sessionId, computerId]);

  // opponent points key is discovered when we see the first stroke_point
  const opponentPointsKeyRef = useRef<string | null>(null);

  const loadOpponentPoints = useCallback(() => {
    const key = opponentPointsKeyRef.current;
    if (!key) return;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setOpponentStrokePoints(parsed);
    } catch {
      // ignore
    }
  }, []);

  const persistOpponentPoints = useCallback((points: Array<[number, number]>) => {
    const key = opponentPointsKeyRef.current;
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(points));
    } catch {
      // ignore
    }
  }, []);

  const enqueuePersist = useCallback(
    (event: { ts: number; by: string; type: string; payload: any }) => {
      if (!sessionId || !computerId) return;
      pendingEventsRef.current.push(event);
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = window.setTimeout(() => void persistEvents(), 500);
    },
    [persistEvents, sessionId, computerId]
  );

  useEffect(() => {
    if (!enabled) return;
    if (!sessionId) return;
    setOpponentStrokePoints([]);
    opponentPointsKeyRef.current = null;

    // Supabase path (preferred)
    if (isSupabaseConfigured) {
      const channel = supabase.channel(`session:${sessionId}`);
      realtimeRef.current = channel;

      // Best-effort restore from last 5 events
      void (async () => {
        try {
          const { data } = await supabase
            .from("session_state")
            .select("last5_events")
            .eq("session_id", sessionId)
            .maybeSingle();
          const events = Array.isArray((data as any)?.last5_events) ? (data as any).last5_events : [];
          for (const e of events) {
            if (!e || typeof e !== "object") continue;
            if (computerId && e.by === computerId) continue;
            if (e.type === "cursor" && e.payload) setOpponentCursor(e.payload);
            if (e.type === "preview" && e.payload?.dataUrl) setOpponentPreview(e.payload.dataUrl);
          }
        } catch {
          // ignore
        }
      })();

      channel
        .on("broadcast", { event: "hello" }, ({ payload }) => {
          const msg = payload as MultiplayerMessage;
          if (!msg || msg.type !== "hello") return;
          if (msg.clientId === clientId) return;
          setOpponentId((prev) => prev ?? msg.clientId);
        })
        .on("broadcast", { event: "cursor" }, ({ payload }) => {
          const msg = payload as MultiplayerMessage;
          if (!msg || msg.type !== "cursor") return;
          if (msg.clientId === clientId) return;
          setOpponentId((prev) => prev ?? msg.clientId);
          // hide signal (explicit -1/-1)
          if (msg.payload.x <= -0.5 || msg.payload.y <= -0.5) {
            setOpponentCursor(null);
            setOpponentCursorTrail([]);
            return;
          }
          setOpponentCursor(msg.payload);
          setOpponentCursorTrail((prev) => {
            const next = [...prev, [msg.payload.x, msg.payload.y] as [number, number]];
            return next.length > 10 ? next.slice(-10) : next;
          });
        })
        .on("broadcast", { event: "round_state" }, ({ payload }) => {
          const msg = payload as MultiplayerMessage;
          if (!msg || msg.type !== "round_state") return;
          if (msg.clientId === clientId) return;
          setOpponentId((prev) => prev ?? msg.clientId);
          setOpponentRoundState({ round: msg.round, phase: msg.phase });
        })
        .on("broadcast", { event: "preview" }, ({ payload }) => {
          const msg = payload as MultiplayerMessage;
          if (!msg || msg.type !== "preview") return;
          if (msg.clientId === clientId) return;
          setOpponentId((prev) => prev ?? msg.clientId);
          setOpponentPreview(msg.dataUrl);
          setOpponentRound(msg.round);
        })
        .on("broadcast", { event: "score" }, ({ payload }) => {
          const msg = payload as MultiplayerMessage;
          if (!msg || msg.type !== "score") return;
          if (msg.clientId === clientId) return;
          setOpponentId((prev) => prev ?? msg.clientId);
          setOpponentTotalScore(msg.totalScore);
          setOpponentScoreRound(msg.round);
        })
        .on("broadcast", { event: "stroke_point" }, ({ payload }) => {
          const msg = payload as MultiplayerMessage;
          if (!msg || msg.type !== "stroke_point") return;
          if (msg.clientId === clientId) return;
          setOpponentId((prev) => prev ?? msg.clientId);
          if (!opponentPointsKeyRef.current) {
            opponentPointsKeyRef.current = `contour_session:${sessionId}:round:${msg.round}:stroke_points:${msg.by}`;
            loadOpponentPoints();
          }
          setOpponentStrokePoints((prev) => {
            const next = [...prev, [msg.x, msg.y] as [number, number]];
            const capped = next.length > 8000 ? next.slice(-8000) : next;
            persistOpponentPoints(capped);
            return capped;
          });
        })
        .on("broadcast", { event: "sync_request" }, ({ payload }) => {
          const msg = payload as MultiplayerMessage;
          if (!msg || msg.type !== "sync_request") return;
          if (msg.clientId === clientId) return;
          if (!computerId) return;
          // Respond with our locally-stored points for that round (best-effort).
          try {
            const key = `contour_session:${sessionId}:round:${msg.round}:stroke_points:${computerId}`;
            const raw = localStorage.getItem(key);
            const points = raw ? (JSON.parse(raw) as Array<[number, number]>) : [];
            channel.send({
              type: "broadcast",
              event: "sync_response",
              payload: {
                type: "sync_response",
                clientId,
                ts: safeNow(),
                round: msg.round,
                by: computerId,
                points: Array.isArray(points) ? points : [],
              } satisfies MultiplayerMessage,
            });
          } catch {
            // ignore
          }
        })
        .on("broadcast", { event: "sync_response" }, ({ payload }) => {
          const msg = payload as MultiplayerMessage;
          if (!msg || msg.type !== "sync_response") return;
          if (msg.clientId === clientId) return;
          if (!opponentPointsKeyRef.current) {
            opponentPointsKeyRef.current = `contour_session:${sessionId}:round:${msg.round}:stroke_points:${msg.by}`;
          }
          if (Array.isArray(msg.points)) {
            setOpponentStrokePoints(msg.points);
            persistOpponentPoints(msg.points);
          }
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            channel.send({
              type: "broadcast",
              event: "hello",
              payload: { type: "hello", clientId, ts: safeNow() } satisfies MultiplayerMessage,
            });
            // Ask the other peer to sync points for this round (best-effort).
            channel.send({
              type: "broadcast",
              event: "sync_request",
              payload: { type: "sync_request", clientId, ts: safeNow(), round } satisfies MultiplayerMessage,
            });
          }
        });

      return () => {
        if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
        pendingEventsRef.current = [];
        realtimeRef.current = null;
        void supabase.removeChannel(channel);
      };
    }

    // BroadcastChannel fallback
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel(`contour-multiplayer:${sessionId}`);
    bcRef.current = bc;

    const onMessage = (event: MessageEvent) => {
      const msg = event.data as MultiplayerMessage;
      if (!msg || typeof msg !== "object") return;
      if ("clientId" in msg && msg.clientId === clientId) return;

      if (msg.type === "hello") {
        setOpponentId((prev) => prev ?? msg.clientId);
        return;
      }
      if (msg.type === "cursor") {
        setOpponentId((prev) => prev ?? msg.clientId);
        if (msg.payload.x <= -0.5 || msg.payload.y <= -0.5) {
          setOpponentCursor(null);
          setOpponentCursorTrail([]);
          return;
        }
        setOpponentCursor(msg.payload);
        setOpponentCursorTrail((prev) => {
          const next = [...prev, [msg.payload.x, msg.payload.y] as [number, number]];
          return next.length > 10 ? next.slice(-10) : next;
        });
        return;
      }
      if (msg.type === "round_state") {
        setOpponentId((prev) => prev ?? msg.clientId);
        setOpponentRoundState({ round: msg.round, phase: msg.phase });
        return;
      }
      if (msg.type === "preview") {
        setOpponentId((prev) => prev ?? msg.clientId);
        setOpponentPreview(msg.dataUrl);
        setOpponentRound(msg.round);
        return;
      }
      if (msg.type === "score") {
        setOpponentId((prev) => prev ?? msg.clientId);
        setOpponentTotalScore(msg.totalScore);
        setOpponentScoreRound(msg.round);
      }
    };

    bc.addEventListener("message", onMessage);
    bc.postMessage({ type: "hello", clientId, ts: safeNow() } satisfies MultiplayerMessage);

    return () => {
      bc.removeEventListener("message", onMessage);
      bc.close();
      bcRef.current = null;
    };
  }, [enabled, sessionId, clientId, computerId, round, loadOpponentPoints, persistOpponentPoints]);

  const send = useCallback((event: "hello" | "cursor" | "preview" | "score", payload: MultiplayerMessage) => {
    if (!enabled) return;
    if (isSupabaseConfigured && realtimeRef.current) {
      realtimeRef.current.send({ type: "broadcast", event, payload });
      return;
    }
    const bc = bcRef.current;
    if (!bc) return;
    bc.postMessage(payload);
  }, [enabled]);

  const sendCursor = useCallback(
    (x: number, y: number, tool?: string) => {
      const now = safeNow();
      if (now - lastCursorSentAtRef.current < 40) return;
      lastCursorSentAtRef.current = now;
      const payload = { type: "cursor", clientId, ts: now, payload: { x, y, tool, ts: now } } satisfies MultiplayerMessage;
      send("cursor", payload);
      // Do not persist cursor events to DB (too high frequency).
    },
    [clientId, send]
  );

  const sendPreview = useCallback(
    (dataUrl: string, round: number) => {
      const now = safeNow();
      if (now - lastPreviewSentAtRef.current < 250) return;
      lastPreviewSentAtRef.current = now;
      const payload = { type: "preview", clientId, ts: now, round, dataUrl } satisfies MultiplayerMessage;
      send("preview", payload);
      if (computerId) enqueuePersist({ ts: now, by: computerId, type: "preview", payload: { round, dataUrl } });
    },
    [clientId, send, enqueuePersist, computerId]
  );

  const sendRoundState = useCallback(
    (round: number, phase: string) => {
      const now = safeNow();
      const payload = { type: "round_state", clientId, ts: now, round, phase } satisfies MultiplayerMessage;
      send("round_state", payload);
    },
    [clientId, send]
  );

  const sendStrokePoint = useCallback(
    (x: number, y: number, round: number) => {
      if (!sessionId || !computerId) return;
      const now = safeNow();
      if (now - lastStrokeSentAtRef.current < 30) return;
      lastStrokeSentAtRef.current = now;
      const payload = { type: "stroke_point", clientId, ts: now, round, by: computerId, x, y } satisfies MultiplayerMessage;
      send("stroke_point", payload);

      // persist locally for refresh
      try {
        const key = `contour_session:${sessionId}:round:${round}:stroke_points:${computerId}`;
        const raw = localStorage.getItem(key);
        const prev = raw ? (JSON.parse(raw) as Array<[number, number]>) : [];
        const next = Array.isArray(prev) ? [...prev, [x, y] as [number, number]] : [[x, y] as [number, number]];
        const capped = next.length > 8000 ? next.slice(-8000) : next;
        localStorage.setItem(key, JSON.stringify(capped));
      } catch {
        // ignore
      }
    },
    [clientId, send, sessionId, computerId]
  );

  const sendScore = useCallback(
    (totalScore: number, round: number) => {
      const now = safeNow();
      const payload = { type: "score", clientId, ts: now, round, totalScore } satisfies MultiplayerMessage;
      send("score", payload);
    },
    [clientId, send]
  );

  return {
    clientId,
    opponentId,
    opponentPreview,
    opponentRound,
    opponentTotalScore,
    opponentScoreRound,
    opponentCursor,
    opponentCursorTrail,
    opponentStrokePoints,
    opponentRoundState,
    sendCursor,
    sendPreview,
    sendRoundState,
    sendStrokePoint,
    sendScore,
    isSupported: isSupabaseConfigured || typeof BroadcastChannel !== "undefined",
  };
}
