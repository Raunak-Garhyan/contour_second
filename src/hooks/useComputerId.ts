import { useEffect, useMemo, useRef } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";

function getOrCreateComputerId() {
  const key = "contour_computer_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

function getFingerprint() {
  try {
    const ua = navigator.userAgent || "";
    const lang = navigator.language || "";
    const platform = (navigator as any).platform || "";
    const hw = (navigator as any).hardwareConcurrency || "";
    const mem = (navigator as any).deviceMemory || "";
    return [ua, lang, platform, hw, mem].filter(Boolean).join("|");
  } catch {
    return "";
  }
}

export function useComputerId(opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled ?? true;
  const computerId = useMemo(() => getOrCreateComputerId(), []);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!isSupabaseConfigured) return;

    const touch = async () => {
      try {
        await supabase.rpc("touch_computer", {
          p_computer_id: computerId,
          p_user_agent: navigator.userAgent ?? "",
          p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
          p_fingerprint: getFingerprint(),
        });
      } catch {
        // ignore
      }
    };

    void touch();
    timerRef.current = window.setInterval(touch, 25_000);

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [computerId, enabled]);

  return { computerId };
}

