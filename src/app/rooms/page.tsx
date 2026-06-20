"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type RoomRow = {
  id: string;
  room_code: string;
  status: string;
  owner_id: string | null;
  created_at: string | null;
};

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const chars = Array.from({ length: 6 }, () =>
    alphabet[Math.floor(Math.random() * alphabet.length)]
  );

  return `R-${chars.join("")}`;
}

function statusLabel(status: string) {
  switch (status) {
    case "waiting":
      return "入室待ち";
    case "playing":
      return "対戦中";
    case "finished":
      return "終了";
    default:
      return status;
  }
}

function formatDate(value: string | null) {
  if (!value) return "-";

  return new Date(value).toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export default function RoomsPage() {
  const router = useRouter();

  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [message, setMessage] = useState("");
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [joiningRoom, setJoiningRoom] = useState(false);

  const normalizedRoomCode = useMemo(
    () => roomCodeInput.trim().toUpperCase(),
    [roomCodeInput]
  );

  useEffect(() => {
    void loadRooms();
  }, []);

  async function loadRooms() {
    setLoadingRooms(true);
    setMessage("");

    const { data, error } = await supabase
      .from("rooms")
      .select("id, room_code, status, owner_id, created_at")
      .in("status", ["waiting", "playing"])
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      console.error(error);
      setMessage(`ルーム一覧の取得に失敗しました：${error.message}`);
      setRooms([]);
      setLoadingRooms(false);
      return;
    }

    setRooms((data ?? []) as RoomRow[]);
    setLoadingRooms(false);
  }

  async function createRoom() {
    setCreatingRoom(true);
    setMessage("");

    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setMessage("ログイン状態を確認できませんでした。ログインし直してください。");
      setCreatingRoom(false);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (profileError || !profile?.id) {
      console.error(profileError);
      setMessage("プロフィール情報を確認できませんでした。プロフィール設定を開いてから再度お試しください。");
      setCreatingRoom(false);
      return;
    }

    let roomCode = createRoomCode();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data, error } = await supabase
        .from("rooms")
        .insert({
          room_code: roomCode,
          owner_id: profile.id,
          player1_id: profile.id,
          player2_id: null,
          status: "waiting"
        })
        .select("room_code")
        .single();

      if (!error && data?.room_code) {
        router.push(`/rooms/${data.room_code}`);
        return;
      }

      if (error?.code === "23505") {
        roomCode = createRoomCode();
        continue;
      }

      console.error(error);
      setMessage(`ルーム作成に失敗しました：${error?.message ?? "不明なエラー"}`);
      setCreatingRoom(false);
      return;
    }

    setMessage("ルームコードの生成に失敗しました。もう一度お試しください。");
    setCreatingRoom(false);
  }

  async function joinRoom(roomCode?: string) {
    const code = (roomCode ?? normalizedRoomCode).trim().toUpperCase();

    if (!code) {
      setMessage("入室するルームIDを入力してください。");
      return;
    }

    setJoiningRoom(true);
    setMessage("");

    const { data, error } = await supabase
      .from("rooms")
      .select("room_code")
      .eq("room_code", code)
      .maybeSingle();

    if (error) {
      console.error(error);
      setMessage(`ルーム確認に失敗しました：${error.message}`);
      setJoiningRoom(false);
      return;
    }

    if (!data?.room_code) {
      setMessage("指定されたルームが見つかりませんでした。");
      setJoiningRoom(false);
      return;
    }

    router.push(`/rooms/${data.room_code}`);
  }

  return (
    <main className="replace-page">
      <section className="replace-shell">
        <header className="replace-header">
          <div>
            <p className="replace-kicker">ROOM</p>
            <h1>ルーム</h1>
            <p>対戦ルームの作成・入室を行います。</p>
          </div>

          <Link href="/home" className="soft-link">
            ホームへ
          </Link>
        </header>

        {message && (
          <section className="message-card">
            {message}
          </section>
        )}

        <section className="top-grid">
          <article className="replace-panel create-panel">
            <div>
              <span className="panel-icon">＋</span>
              <h2>新しくルームを作成</h2>
              <p>player1としてルームを作成します。</p>
            </div>

            <button
              type="button"
              onClick={createRoom}
              disabled={creatingRoom}
              className="primary-button"
            >
              {creatingRoom ? "作成中..." : "ルームを作成"}
            </button>
          </article>

          <article className="replace-panel">
            <div>
              <span className="panel-icon lavender">↪</span>
              <h2>ルームIDで入室</h2>
              <p>共有されたルームコードを入力してください。</p>
            </div>

            <div className="join-row">
              <input
                value={roomCodeInput}
                onChange={(event) => setRoomCodeInput(event.target.value)}
                placeholder="例：R-USRSH3"
              />

              <button
                type="button"
                onClick={() => void joinRoom()}
                disabled={joiningRoom}
                className="secondary-button"
              >
                {joiningRoom ? "確認中..." : "入室"}
              </button>
            </div>
          </article>
        </section>

        <section className="replace-panel rooms-panel">
          <div className="section-head">
            <div>
              <p className="replace-kicker">ROOM LIST</p>
              <h2>進行中・入室待ちルーム</h2>
            </div>

            <button
              type="button"
              onClick={() => void loadRooms()}
              disabled={loadingRooms}
              className="secondary-button"
            >
              {loadingRooms ? "更新中..." : "更新"}
            </button>
          </div>

          {loadingRooms ? (
            <p className="muted">読み込み中...</p>
          ) : rooms.length === 0 ? (
            <p className="muted">表示できるルームはありません。</p>
          ) : (
            <div className="room-list">
              {rooms.map((room) => {
                const isPlaying = room.status === "playing";
                const icon = isPlaying ? "⚔️" : "👥";

                return (
                  <article key={room.id} className="room-card">
                    <div className={`room-avatar ${isPlaying ? "playing" : ""}`}>
                      {icon}
                    </div>

                    <div className="room-main">
                      <strong>{room.room_code}</strong>
                      <span>状態：{statusLabel(room.status)}</span>
                    </div>

                    <div className="room-meta">
                      <span className={`status-pill ${isPlaying ? "playing" : ""}`}>
                        {statusLabel(room.status)}
                      </span>
                      <span>{formatDate(room.created_at)}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => void joinRoom(room.room_code)}
                      className="primary-button small"
                    >
                      入室
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </section>

      <style jsx>{`
        .replace-page {
          min-height: 100vh;
          padding: 28px;
          background:
            radial-gradient(circle at 10% 18%, rgba(191, 219, 254, .8), transparent 28%),
            radial-gradient(circle at 88% 10%, rgba(221, 214, 254, .72), transparent 26%),
            radial-gradient(circle at 80% 86%, rgba(186, 230, 253, .58), transparent 28%),
            linear-gradient(180deg, #f8fbff 0%, #eef6ff 100%);
          color: #172554;
        }

        .replace-shell {
          max-width: 1100px;
          margin: 0 auto;
          display: grid;
          gap: 18px;
        }

        .replace-header {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: center;
          flex-wrap: wrap;
          border: 1px solid rgba(147, 197, 253, .72);
          border-radius: 28px;
          padding: 26px;
          background: rgba(255, 255, 255, .78);
          box-shadow: 0 18px 48px rgba(59, 130, 246, .12);
        }

        .replace-header h1,
        .replace-panel h2 {
          margin: 0;
        }

        .replace-header h1 {
          color: #2563eb;
          font-size: clamp(34px, 5vw, 50px);
          line-height: 1.1;
        }

        .replace-header p:not(.replace-kicker) {
          margin: 8px 0 0;
          color: #64748b;
        }

        .replace-kicker {
          margin: 0 0 6px;
          color: #7c3aed;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: .12em;
        }

        .soft-link,
        .primary-button,
        .secondary-button {
          border: 1px solid rgba(96, 165, 250, .72);
          border-radius: 14px;
          padding: 10px 14px;
          font-weight: 800;
          text-decoration: none;
          cursor: pointer;
          transition: transform .16s ease, box-shadow .16s ease, background .16s ease;
        }

        .soft-link {
          background: rgba(255, 255, 255, .76);
          color: #1d4ed8;
        }

        .primary-button {
          background: linear-gradient(135deg, #93c5fd, #bfdbfe);
          color: #1e3a8a;
          box-shadow: 0 10px 22px rgba(37, 99, 235, .16);
        }

        .secondary-button {
          background: rgba(255, 255, 255, .76);
          color: #1d4ed8;
        }

        .primary-button:hover,
        .secondary-button:hover,
        .soft-link:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 28px rgba(37, 99, 235, .16);
        }

        .primary-button:disabled,
        .secondary-button:disabled {
          opacity: .55;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .small {
          padding: 8px 12px;
          border-radius: 12px;
        }

        .message-card {
          border: 1px solid rgba(250, 204, 21, .7);
          border-radius: 18px;
          padding: 14px 16px;
          background: rgba(254, 249, 195, .85);
          color: #854d0e;
          font-weight: 800;
          box-shadow: 0 10px 24px rgba(250, 204, 21, .12);
        }

        .top-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 16px;
        }

        .replace-panel {
          border: 1px solid rgba(147, 197, 253, .68);
          border-radius: 22px;
          padding: 20px;
          background: rgba(255, 255, 255, .86);
          box-shadow: 0 14px 34px rgba(59, 130, 246, .1);
          display: grid;
          gap: 14px;
        }

        .replace-panel p {
          margin: 8px 0 0;
          color: #64748b;
          line-height: 1.6;
        }

        .panel-icon {
          width: 46px;
          height: 46px;
          border-radius: 16px;
          display: grid;
          place-items: center;
          margin-bottom: 12px;
          background: linear-gradient(135deg, #dbeafe, #bae6fd);
          color: #2563eb;
          font-size: 24px;
          font-weight: 900;
        }

        .panel-icon.lavender {
          background: linear-gradient(135deg, #ede9fe, #dbeafe);
          color: #7c3aed;
        }

        .join-row {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        input {
          min-width: 220px;
          flex: 1;
          border: 1px solid rgba(147, 197, 253, .82);
          border-radius: 14px;
          padding: 11px 13px;
          background: rgba(255, 255, 255, .88);
          color: #172554;
          outline: none;
        }

        input:focus {
          border-color: #60a5fa;
          box-shadow: 0 0 0 4px rgba(147, 197, 253, .22);
        }

        .section-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }

        .muted {
          color: #64748b;
        }

        .room-list {
          display: grid;
          gap: 10px;
        }

        .room-card {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto auto;
          gap: 12px;
          align-items: center;
          border: 1px solid rgba(191, 219, 254, .92);
          border-radius: 18px;
          padding: 14px;
          background: rgba(255, 255, 255, .78);
          box-shadow: 0 10px 22px rgba(59, 130, 246, .08);
        }

        .room-avatar {
          width: 48px;
          height: 48px;
          border-radius: 18px;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #dbeafe, #bae6fd);
          font-size: 24px;
        }

        .room-avatar.playing {
          background: linear-gradient(135deg, #ede9fe, #f5d0fe);
        }

        .room-main {
          display: grid;
          gap: 4px;
          min-width: 0;
        }

        .room-main strong {
          font-size: 19px;
          color: #172554;
        }

        .room-main span,
        .room-meta span:last-child {
          color: #64748b;
          font-size: 13px;
        }

        .room-meta {
          display: grid;
          justify-items: end;
          gap: 5px;
        }

        .status-pill {
          border-radius: 999px;
          padding: 5px 10px;
          background: #dbeafe;
          color: #1d4ed8;
          font-size: 12px;
          font-weight: 800;
        }

        .status-pill.playing {
          background: #ede9fe;
          color: #7c3aed;
        }

        @media (max-width: 760px) {
          .replace-page {
            padding: 16px;
          }

          .room-card {
            grid-template-columns: auto 1fr;
          }

          .room-meta {
            justify-items: start;
            grid-column: 2;
          }

          .room-card .primary-button {
            grid-column: 1 / -1;
            width: 100%;
          }
        }
      `}</style>
    </main>
  );
}
