"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  isSupabasePostgresChangeMessage,
  projectStatusRealtimeJoinPayload,
  projectStatusRealtimeTopic,
  supabaseRealtimeWebSocketUrl,
  type SupabaseRealtimeConfig
} from "@/lib/realtime/supabase-realtime";

type StatusAutoRefreshProps = {
  enabled: boolean;
  projectId: string;
  intervalMs?: number;
  realtime?: SupabaseRealtimeConfig | null;
};

export function StatusAutoRefresh({ enabled, projectId, intervalMs = 6000, realtime }: StatusAutoRefreshProps) {
  const router = useRouter();
  const [pollingFallback, setPollingFallback] = useState(true);

  useEffect(() => {
    if (!enabled || !realtime?.accessToken) {
      setPollingFallback(true);
      return;
    }

    let ref = 1;
    let closed = false;
    const socket = new WebSocket(supabaseRealtimeWebSocketUrl(realtime));
    const topic = projectStatusRealtimeTopic(projectId);
    const nextRef = () => String(ref++);

    const send = (event: string, payload: object, topicName = topic) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ topic: topicName, event, payload, ref: nextRef() }));
    };

    const heartbeat = window.setInterval(() => {
      send("heartbeat", {}, "phoenix");
    }, 25000);

    socket.addEventListener("open", () => {
      send("access_token", { access_token: realtime.accessToken }, "phoenix");
      send("phx_join", projectStatusRealtimeJoinPayload(projectId, realtime.accessToken));
    });

    socket.addEventListener("message", (event) => {
      const message = safeJsonParse(event.data);
      if (isSupabasePostgresChangeMessage(message)) {
        router.refresh();
        return;
      }
      if (isJoinAck(message)) {
        setPollingFallback(false);
      }
    });

    socket.addEventListener("error", () => {
      if (!closed) setPollingFallback(true);
    });

    socket.addEventListener("close", () => {
      if (!closed) setPollingFallback(true);
    });

    return () => {
      closed = true;
      window.clearInterval(heartbeat);
      socket.close();
    };
  }, [enabled, projectId, realtime, router]);

  useEffect(() => {
    if (!enabled || !pollingFallback) return;
    const timer = window.setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, pollingFallback, router]);

  return null;
}

function safeJsonParse(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isJoinAck(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const payload = record.payload as Record<string, unknown> | undefined;
  return record.event === "phx_reply" && payload?.status === "ok";
}
