import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

import contourApple from "@/assets/contours/apple.svg";
import contourCheck from "@/assets/contours/check.svg";
import contourDribbble from "@/assets/contours/dribbble.svg";
import contourDropper from "@/assets/contours/dropper.svg";
import contourInstagram from "@/assets/contours/instagram.svg";
import contourKey from "@/assets/contours/key.svg";
import contourMcdonalds from "@/assets/contours/mcdonalds.svg";
import contourMushroom from "@/assets/contours/mushroom.svg";
import contourSky from "@/assets/contours/sky.svg";

export interface ContourPrompt {
  id: string;
  title: string;
  src: string;
}

export const CONTOUR_LIBRARY: ContourPrompt[] = [
  { id: "apple", title: "Apple Logo", src: contourApple },
  { id: "check", title: "Check Mark", src: contourCheck },
  { id: "dribbble", title: "Dribbble", src: contourDribbble },
  { id: "dropper", title: "Dropper", src: contourDropper },
  { id: "instagram", title: "Instagram", src: contourInstagram },
  { id: "key", title: "Skeleton Key", src: contourKey },
  { id: "mcdonalds", title: "McDonald's", src: contourMcdonalds },
  { id: "mushroom", title: "Mushroom", src: contourMushroom },
  { id: "sky", title: "Skyline", src: contourSky },
];

export type GamePhase = "idle" | "matchmaking" | "countdown" | "draw" | "scoring" | "roundResult" | "finalResults";
export type GameMode = "solo" | "multiplayer";

export interface RoundResult {
  round: number;
  promptId: string;
  promptTitle: string;
  score: number;
  drawingDataUrl: string;
  originalSrc: string;
}

interface GameState {
  mode: GameMode | null;
  phase: GamePhase;
  currentRound: number;
  totalRounds: number;
  drawTime: number;
  currentPrompt: ContourPrompt | null;
  results: RoundResult[];
  playerName: string;
  usedPromptIds: string[];
  soundEnabled: boolean;
  multiplayerSessionId: string | null;
  multiplayerRole: "player1" | "player2" | null;
  multiplayerPromptOrder: string[] | null;
  matchmakingRequestId: number | null;
}

interface GameContextType extends GameState {
  startGame: (mode: GameMode, playerName?: string) => void;
  startMatchmaking: (playerName?: string) => void;
  setMultiplayerSession: (sessionId: string, role: "player1" | "player2") => void;
  enterMatchmakingLobby: (sessionId: string, role: "player1" | "player2") => void;
  beginMultiplayer: (sessionId: string) => void;
  hydrateMultiplayer: (sessionId: string, role: "player1" | "player2", snapshot?: Partial<GameState>) => void;
  syncRound: (round: number) => void;
  setPhase: (phase: GamePhase) => void;
  submitRound: (drawingDataUrl: string, score: number) => void;
  nextRound: () => void;
  resetGame: () => void;
  toggleSound: () => void;
}

const GameContext = createContext<GameContextType | null>(null);

function pickRandomPrompt(usedIds: string[]): ContourPrompt {
  const available = CONTOUR_LIBRARY.filter((p) => !usedIds.includes(p.id));
  const pool = available.length > 0 ? available : CONTOUR_LIBRARY;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickRandomPrompts(count: number): ContourPrompt[] {
  const shuffled = [...CONTOUR_LIBRARY].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

const INITIAL_STATE: GameState = {
  mode: null,
  phase: "idle",
  currentRound: 0,
  totalRounds: 4,
  drawTime: 300,
  currentPrompt: null,
  results: [],
  playerName: "",
  usedPromptIds: [],
  soundEnabled: true,
  multiplayerSessionId: null,
  multiplayerRole: null,
  multiplayerPromptOrder: null,
  matchmakingRequestId: null,
};

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  const matchmakingRequestRef = React.useRef(0);

  const startGame = useCallback((mode: GameMode, playerName?: string) => {
    const prompt = pickRandomPrompt([]);
    setState({
      ...INITIAL_STATE,
      mode,
      phase: "countdown",
      currentRound: 1,
      currentPrompt: prompt,
      playerName: playerName || "Player",
      usedPromptIds: [prompt.id],
      soundEnabled: state.soundEnabled,
    });
  }, [state.soundEnabled]);

  const startMatchmaking = useCallback((playerName?: string) => {
    matchmakingRequestRef.current += 1;
    setState((prev) => ({
      ...INITIAL_STATE,
      mode: "multiplayer",
      phase: "matchmaking" as GamePhase,
      playerName: playerName || "Player",
      soundEnabled: prev.soundEnabled,
      matchmakingRequestId: matchmakingRequestRef.current,
    }));
  }, []);

  const setMultiplayerSession = useCallback((sessionId: string, role: "player1" | "player2") => {
    setState((prev) => ({
      ...prev,
      multiplayerSessionId: sessionId,
      multiplayerRole: role,
    }));
  }, []);

  const enterMatchmakingLobby = useCallback((sessionId: string, role: "player1" | "player2") => {
    setState((prev) => ({
      ...INITIAL_STATE,
      mode: "multiplayer",
      phase: "matchmaking",
      playerName: prev.playerName || "Player",
      soundEnabled: prev.soundEnabled,
      multiplayerSessionId: sessionId,
      multiplayerRole: role,
    }));
  }, []);

  function seedFromString(input: string) {
    // simple deterministic hash -> uint32
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed: number) {
    return function () {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffledPromptIds(seed: string, count: number) {
    const rng = mulberry32(seedFromString(seed));
    const ids = CONTOUR_LIBRARY.map((p) => p.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids.slice(0, count);
  }

  const beginMultiplayer = useCallback((sessionId: string) => {
    setState((prev) => {
      const order = shuffledPromptIds(sessionId, prev.totalRounds);
      const first = CONTOUR_LIBRARY.find((p) => p.id === order[0]) ?? pickRandomPrompt([]);
      return {
        ...prev,
        mode: "multiplayer",
        phase: "countdown",
        currentRound: 1,
        currentPrompt: first,
        usedPromptIds: [first.id],
        multiplayerSessionId: sessionId,
        multiplayerPromptOrder: order,
      };
    });
  }, []);

  const hydrateMultiplayer = useCallback(
    (sessionId: string, role: "player1" | "player2", snapshot?: Partial<GameState>) => {
      setState((prev) => {
        const base: GameState = {
          ...INITIAL_STATE,
          soundEnabled: prev.soundEnabled,
          playerName: prev.playerName || "Player",
          mode: "multiplayer",
          phase: "draw",
          multiplayerSessionId: sessionId,
          multiplayerRole: role,
        };

        const merged: GameState = { ...base, ...(snapshot as any) };
        merged.mode = "multiplayer";
        merged.multiplayerSessionId = sessionId;
        merged.multiplayerRole = role;

        const order = merged.multiplayerPromptOrder ?? shuffledPromptIds(sessionId, merged.totalRounds);
        merged.multiplayerPromptOrder = order;

        const round = merged.currentRound && merged.currentRound > 0 ? merged.currentRound : 1;
        merged.currentRound = Math.min(Math.max(round, 1), merged.totalRounds);

        const promptId = order[merged.currentRound - 1] ?? order[0];
        merged.currentPrompt = CONTOUR_LIBRARY.find((p) => p.id === promptId) ?? pickRandomPrompt([]);

        merged.usedPromptIds =
          merged.usedPromptIds && merged.usedPromptIds.length > 0
            ? merged.usedPromptIds
            : order.slice(0, merged.currentRound);

        // If snapshot phase is not one of the in-game phases, default to draw.
        if (merged.phase === "idle" || merged.phase === "matchmaking") merged.phase = "draw";
        // Avoid restoring transient overlays after refresh.
        if (merged.phase === "scoring" || merged.phase === "roundResult") merged.phase = "draw";
        // If game is complete, always land on final results.
        if (merged.results.length >= merged.totalRounds) merged.phase = "finalResults";

        return merged;
      });
    },
    []
  );

  const syncRound = useCallback((round: number) => {
    setState((prev) => {
      if (prev.mode !== "multiplayer" || !prev.multiplayerSessionId) return prev;
      const order = prev.multiplayerPromptOrder ?? shuffledPromptIds(prev.multiplayerSessionId, prev.totalRounds);
      const nextRound = Math.min(Math.max(round, 1), prev.totalRounds);
      const promptId = order[nextRound - 1] ?? order[0];
      const prompt = CONTOUR_LIBRARY.find((p) => p.id === promptId) ?? pickRandomPrompt([]);
      return {
        ...prev,
        multiplayerPromptOrder: order,
        currentRound: nextRound,
        currentPrompt: prompt,
        usedPromptIds: order.slice(0, nextRound),
        phase: "countdown",
      };
    });
  }, []);

  // Persist multiplayer progress so refresh can restore it.
  useEffect(() => {
    if (state.mode !== "multiplayer") return;
    if (!state.multiplayerSessionId) return;
    const key = `contour_mp_state:${state.multiplayerSessionId}`;
        const payload = {
      mode: state.mode,
      phase: state.phase,
      currentRound: state.currentRound,
      totalRounds: state.totalRounds,
      drawTime: state.drawTime,
      results: state.results,
      playerName: state.playerName,
      usedPromptIds: state.usedPromptIds,
      soundEnabled: state.soundEnabled,
      multiplayerPromptOrder: state.multiplayerPromptOrder,
      matchmakingRequestId: state.matchmakingRequestId,
    };
    try {
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [
    state.mode,
    state.phase,
    state.currentRound,
    state.totalRounds,
    state.drawTime,
    state.results,
    state.playerName,
    state.usedPromptIds,
    state.soundEnabled,
    state.multiplayerPromptOrder,
    state.matchmakingRequestId,
    state.multiplayerSessionId,
  ]);

  const setPhase = useCallback((phase: GamePhase) => {
    setState((prev) => ({ ...prev, phase }));
  }, []);

  const submitRound = useCallback((drawingDataUrl: string, score: number) => {
    setState((prev) => ({
      ...prev,
      phase: "roundResult",
      results: [
        ...prev.results,
        {
          round: prev.currentRound,
          promptId: prev.currentPrompt!.id,
          promptTitle: prev.currentPrompt!.title,
          score,
          drawingDataUrl,
          originalSrc: prev.currentPrompt!.src,
        },
      ],
    }));
  }, []);

  const nextRound = useCallback(() => {
    setState((prev) => {
      if (prev.currentRound >= prev.totalRounds) {
        return { ...prev, phase: "finalResults" };
      }
      let prompt: ContourPrompt;
      if (prev.mode === "multiplayer" && prev.multiplayerPromptOrder) {
        const nextId = prev.multiplayerPromptOrder[prev.currentRound]!;
        prompt = CONTOUR_LIBRARY.find((p) => p.id === nextId) ?? pickRandomPrompt(prev.usedPromptIds);
      } else {
        prompt = pickRandomPrompt(prev.usedPromptIds);
      }
      return {
        ...prev,
        phase: "countdown",
        currentRound: prev.currentRound + 1,
        currentPrompt: prompt,
        usedPromptIds: [...prev.usedPromptIds, prompt.id],
      };
    });
  }, []);

  const resetGame = useCallback(() => {
    setState((prev) => {
      if (prev.multiplayerSessionId) {
        try {
          localStorage.removeItem(`contour_mp_state:${prev.multiplayerSessionId}`);
        } catch {
          // ignore
        }
      }
      return { ...INITIAL_STATE, soundEnabled: prev.soundEnabled };
    });
  }, []);

  const toggleSound = useCallback(() => {
    setState((prev) => ({ ...prev, soundEnabled: !prev.soundEnabled }));
  }, []);

  return (
    <GameContext.Provider
      value={{
        ...state,
        startGame,
        startMatchmaking,
        setMultiplayerSession,
        enterMatchmakingLobby,
        beginMultiplayer,
        hydrateMultiplayer,
        syncRound,
        setPhase,
        submitRound,
        nextRound,
        resetGame,
        toggleSound,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used inside GameProvider");
  return ctx;
}

export { pickRandomPrompts };
