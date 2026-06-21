"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { getOrCreateProfile } from "@/lib/auth/getOrCreateProfile";

type Profile = {
  id: string;
  nickname: string | null;
  role?: string | null;
  avatar_key?: string | null;
  greeting?: string | null;
};

type HomeCounts = {
  decks: number | null;
  rooms: number | null;
};

function canSeeAdmin(role: string | null | undefined) {
  return role === "owner" || role === "admin" || role === "editor" || role === "support";
}

export default function HomePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [counts, setCounts] = useState<HomeCounts>({ decks: null, rooms: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadHome() {
      const nextProfile = await getOrCreateProfile();
      const typedProfile = nextProfile as Profile | null;

      setProfile(typedProfile);

      if (typedProfile) {
        const [{ count: deckCount }, { count: roomCount }] = await Promise.all([
          supabase
            .from("decks")
            .select("id", { count: "exact", head: true })
            .eq("owner_id", typedProfile.id),
          supabase
            .from("rooms")
            .select("id", { count: "exact", head: true })
        ]);

        setCounts({
          decks: deckCount ?? null,
          rooms: roomCount ?? null
        });
      }

      setLoading(false);
    }

    void loadHome();
  }, []);

  const role = profile?.role ?? "user";
  const greeting = profile?.greeting ?? "今日も楽しくデュエマしましょう。";

  return (
    <main className="replace-page">
      <section className="replace-shell">
        <header className="replace-hero">
          <div className="hero-cloud cloud-left" />
          <div className="hero-cloud cloud-right" />

          <p className="replace-kicker">DM Replace</p>
          <h1>デュエルマスターズ Replace</h1>
          <p className="hero-greeting">
            {loading ? "読み込み中..." : <>ようこそ、<strong>{profile?.nickname ?? "ゲスト"}</strong> さん</>}
          </p>
          <p className="hero-sub">{loading ? "少しだけお待ちください。" : greeting}</p>

          <div className="hero-stats" aria-label="利用状況">
            <span>保存済みデッキ：{counts.decks ?? "-"}個</span>
            <span>ルーム総数：{counts.rooms ?? "-"}件</span>
            <span>権限：{role}</span>
          </div>
        </header>

        <section className="replace-grid" aria-label="メニュー">
          <Link href="/rooms" className="replace-card">
            <span className="replace-icon">🏠</span>
            <strong>ルーム</strong>
            <span>対戦ルームの作成・入室・観戦を行います。</span>
          </Link>

          <Link href="/decks" className="replace-card">
            <span className="replace-icon">🃏</span>
            <strong>デッキ管理</strong>
            <span>新規作成、保存済みデッキ、デッキコードを管理します。</span>
          </Link>

          <Link href="/cards/images" className="replace-card">
            <span className="replace-icon">🖼️</span>
            <strong>カード登録</strong>
            <span>カード画像やプロキシカードを登録します。</span>
          </Link>

          <Link href="/profile" className="replace-card">
            <span className="replace-icon">👤</span>
            <strong>プロフィール</strong>
            <span>名前、アイコン、一言挨拶を編集します。</span>
          </Link>

          <Link href="/other" className="replace-card">
            <span className="replace-icon">📘</span>
            <strong>その他</strong>
            <span>操作説明、サプライ管理、お知らせなどを確認します。</span>
          </Link>

          {canSeeAdmin(role) && (
            <Link href="/admin" className="replace-card admin-card">
              <span className="replace-icon">🛠️</span>
              <strong>管理者</strong>
              <span>カード画像管理、不具合報告、権限管理など。</span>
            </Link>
          )}
        </section>
      </section>

      <style jsx>{`
        .replace-page {
          min-height: 100vh;
          padding: 28px;
          background:
            radial-gradient(circle at 10% 18%, rgba(191, 219, 254, .72), transparent 28%),
            radial-gradient(circle at 88% 10%, rgba(221, 214, 254, .6), transparent 26%),
            radial-gradient(circle at 80% 86%, rgba(186, 230, 253, .5), transparent 28%),
            linear-gradient(180deg, #f8fbff 0%, #eef6ff 100%);
          color: #172554;
        }

        .replace-shell {
          max-width: 1120px;
          margin: 0 auto;
          display: grid;
          gap: 22px;
        }

        .replace-hero {
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(147, 197, 253, .72);
          border-radius: 30px;
          padding: 44px 26px;
          background:
            linear-gradient(135deg, rgba(255, 255, 255, .92), rgba(239, 246, 255, .74)),
            radial-gradient(circle at 22% 24%, rgba(191, 219, 254, .48), transparent 30%);
          box-shadow: 0 16px 38px rgba(59, 130, 246, .1);
          text-align: center;
        }

        .hero-cloud {
          position: absolute;
          width: 94px;
          height: 34px;
          border-radius: 999px;
          background: rgba(255, 255, 255, .72);
        }

        .cloud-left {
          left: -18px;
          bottom: 34px;
        }

        .cloud-right {
          right: -26px;
          top: 42px;
        }

        .replace-kicker {
          margin: 0 0 8px;
          color: #7c3aed;
          font-size: 13px;
          font-weight: 900;
          letter-spacing: .12em;
        }

        h1 {
          margin: 0;
          font-size: clamp(32px, 5vw, 54px);
          line-height: 1.05;
          letter-spacing: .02em;
          color: #2563eb;
          text-shadow: 0 2px 0 rgba(255, 255, 255, .8);
        }

        .hero-greeting {
          margin: 20px 0 0;
          font-size: 18px;
          color: #1e3a8a;
        }

        .hero-sub {
          margin: 8px 0 0;
          color: #64748b;
        }

        .hero-stats {
          width: fit-content;
          max-width: 100%;
          margin: 22px auto 0;
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 8px;
        }

        .hero-stats span {
          border: 1px solid rgba(147, 197, 253, .75);
          border-radius: 999px;
          padding: 7px 12px;
          background: rgba(255, 255, 255, .72);
          color: #1e40af;
          font-size: 13px;
          font-weight: 700;
        }

        .replace-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
          gap: 16px;
        }

        .replace-card {
          min-height: 174px;
          border: 1px solid rgba(147, 197, 253, .7);
          border-radius: 22px;
          padding: 22px;
          background: rgba(255, 255, 255, .86);
          color: #172554;
          text-decoration: none;
          display: grid;
          gap: 10px;
          justify-items: start;
          align-content: start;
          box-shadow: 0 12px 28px rgba(59, 130, 246, .09);
          transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
        }

        .replace-card:hover {
          transform: translateY(-3px);
          border-color: #93c5fd;
          box-shadow: 0 16px 34px rgba(59, 130, 246, .14);
        }

        .replace-icon {
          width: 54px;
          height: 54px;
          border-radius: 18px;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #dbeafe, #ede9fe);
          font-size: 28px;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .7);
        }

        .replace-card strong {
          font-size: 20px;
          color: #1d4ed8;
        }

        .replace-card span:last-child {
          color: #64748b;
          line-height: 1.6;
          font-size: 14px;
        }

        .admin-card {
          border-color: rgba(196, 181, 253, .82);
        }

        @media (max-width: 640px) {
          .replace-page {
            padding: 16px;
          }

          .replace-hero {
            padding: 34px 18px;
          }
        }
      `}</style>
    </main>
  );
}
