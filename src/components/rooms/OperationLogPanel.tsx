"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type OperationLog = {
  id: string;
  room_id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  event_type: string;
  message: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type OperationLogPanelProps = {
  roomId: string;
  currentUserId?: string | null;
};

function formatTime(value: string) {
  const date = new Date(value);

  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function eventLabel(eventType: string) {
  switch (eventType) {
    case "start_game":
      return "開始";
    case "draw":
      return "ドロー";
    case "move_card":
      return "移動";
    case "move_multiple_cards":
      return "複数移動";
    case "move_stack_cards":
      return "重ね移動";
    case "move_from_deck":
      return "山札移動";
    case "return_to_deck":
      return "山札へ";
    case "return_stack_to_deck":
      return "重ね山札へ";
    case "return_to_deck_and_shuffle":
      return "山札戻し";
    case "shuffle_deck":
      return "シャッフル";
    case "deck_check":
    case "deck_public_check":
      return "確認";
    case "deck_select":
    case "deck_public_select":
      return "確認移動";
    case "deck_order":
      return "山札順";
    case "shield_break_check":
      return "確認";
    case "shield_break":
      return "シールド";
    case "reveal_card":
      return "公開";
    case "cancel_reveal_cards":
      return "公開解除";
    case "card_state":
      return "状態";
    case "stack_card":
      return "重ね出し";
    case "undo":
      return "取消";
    default:
      return eventType;
  }
}

function logKind(log: OperationLog, currentUserId?: string | null) {
  if (log.event_type === "start_game" || log.event_type === "undo") {
    return "system";
  }

  if (log.actor_user_id && currentUserId && log.actor_user_id === currentUserId) {
    return "mine";
  }

  return "opponent";
}

function logColor(kind: "mine" | "opponent" | "system") {
  switch (kind) {
    case "mine":
      return "#7ee787";
    case "opponent":
      return "#79c0ff";
    case "system":
      return "#d2a8ff";
    default:
      return "#ddd";
  }
}

function logPrefix(kind: "mine" | "opponent" | "system") {
  switch (kind) {
    case "mine":
      return "自分";
    case "opponent":
      return "相手";
    case "system":
      return "SYSTEM";
    default:
      return "";
  }
}

function shouldMaskAsChecking(log: OperationLog, currentUserId?: string | null) {
  const kind = logKind(log, currentUserId);

  if (kind === "mine") {
    return false;
  }

  return [
    "deck_check",
    "deck_public_check",
    "deck_select",
    "deck_public_select",
    "shield_break_check"
  ].includes(log.event_type);
}

function safeMessage(log: OperationLog, currentUserId?: string | null) {
  if (shouldMaskAsChecking(log, currentUserId)) {
    return `${log.actor_name ?? "プレイヤー"}が確認中です。`;
  }

  return log.message;
}

export default function OperationLogPanel({
  roomId,
  currentUserId
}: OperationLogPanelProps) {
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const visibleLogs = useMemo(() => logs.slice(-50), [logs]);

  useEffect(() => {
    if (!roomId) return;

    let mounted = true;

    async function loadLogs() {
      const { data, error } = await supabase
        .from("room_operation_logs")
        .select(
          "id, room_id, actor_user_id, actor_name, event_type, message, payload, created_at"
        )
        .eq("room_id", roomId)
        .order("created_at", { ascending: true })
        .limit(50);

      if (error) {
        console.error("操作ログ取得エラー:", error);
        return;
      }

      if (mounted) {
        setLogs((data ?? []) as OperationLog[]);
      }
    }

    loadLogs();

    const channel = supabase
      .channel(`room-operation-logs-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_operation_logs",
          filter: `room_id=eq.${roomId}`
        },
        (payload) => {
          const newLog = payload.new as OperationLog;

          setLogs((prev) => {
            if (prev.some((log) => log.id === newLog.id)) return prev;
            return [...prev.slice(-49), newLog];
          });
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleLogs]);

  return (
    <section
      style={{
        border: "1px solid #444",
        borderRadius: 12,
        background: "#111",
        overflow: "hidden"
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid #333",
          padding: "8px 12px"
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14 }}>操作ログ</h2>
        <span style={{ color: "#aaa", fontSize: 11 }}>
          最新{visibleLogs.length}件
        </span>
      </div>

      <div
        style={{
          height: 190,
          overflowY: "auto",
          padding: 12,
          fontFamily: "ui-monospace, Consolas, monospace",
          fontSize: 12,
          lineHeight: 1.7,
          display: "grid",
          gap: 4,
          alignContent: "start"
        }}
      >
        {visibleLogs.length === 0 ? (
          <p style={{ color: "#777", margin: 0 }}>まだ操作ログはありません。</p>
        ) : (
          visibleLogs.map((log) => {
            const kind = logKind(log, currentUserId);
            const color = logColor(kind);

            return (
              <div
                key={log.id}
                style={{
                  color,
                  borderLeft: `3px solid ${color}`,
                  paddingLeft: 8,
                  background:
                    kind === "mine"
                      ? "rgba(126, 231, 135, 0.06)"
                      : kind === "opponent"
                        ? "rgba(121, 192, 255, 0.06)"
                        : "rgba(210, 168, 255, 0.06)",
                  borderRadius: 6,
                  paddingTop: 3,
                  paddingBottom: 3
                }}
              >
                <span style={{ color: "#777" }}>
                  [{formatTime(log.created_at)}]
                </span>{" "}
                <span style={{ color: "#aaa" }}>
                  {eventLabel(log.event_type)}
                </span>{" "}
                <span style={{ color: "#888" }}>
                  {logPrefix(kind)}：
                </span>
                {safeMessage(log, currentUserId)}
              </div>
            );
          })
        )}

        <div ref={bottomRef} />
      </div>
    </section>
  );
}
