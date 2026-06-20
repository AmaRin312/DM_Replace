"use client";

import { useEffect, useState } from "react";
import { NavigationCard } from "@/components/layout/NavigationCard";
import { getOrCreateProfile } from "@/lib/auth/getOrCreateProfile";

type Profile = {
  id: string;
  nickname: string | null;
  role?: string | null;
};

function canOpenAdmin(role: string | null | undefined) {
  return role === "owner" || role === "admin" || role === "editor" || role === "support";
}

function canManageCards(role: string | null | undefined) {
  return role === "owner" || role === "admin" || role === "editor";
}

function canManagePermissions(role: string | null | undefined) {
  return role === "owner";
}

function canViewSupportTools(role: string | null | undefined) {
  return role === "owner" || role === "admin" || role === "support";
}

function ComingSoonCard({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <article
      style={{
        border: "1px solid #444",
        borderRadius: 14,
        padding: 18,
        background: "#1f1f1f",
        opacity: 0.82
      }}
    >
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <p className="muted">{description}</p>
      <p className="muted" style={{ marginBottom: 0 }}>
        準備中
      </p>
    </article>
  );
}

export default function AdminPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProfile() {
      const nextProfile = await getOrCreateProfile();
      setProfile(nextProfile as Profile | null);
      setLoading(false);
    }

    void loadProfile();
  }, []);

  if (loading) {
    return (
      <main className="page">
        <h1>管理者</h1>
        <p className="muted">読み込み中...</p>
      </main>
    );
  }

  const role = profile?.role ?? "user";

  if (!canOpenAdmin(role)) {
    return (
      <main className="page">
        <h1>管理者</h1>
        <p className="muted">このページを利用する権限がありません。</p>
        <a href="/home">ホームへ戻る</a>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>管理者</h1>

      <p className="muted">
        管理者向け機能をまとめています。現在の権限：{role}
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <a href="/home">🏠 ホーム</a>
      </div>

      <div className="grid">
        {canManageCards(role) && (
          <NavigationCard
            href="/cards/images"
            title="カード画像管理"
            description="カード画像、文明、コストなどの登録・編集・削除を行います。"
          />
        )}

        {canViewSupportTools(role) && (
          <ComingSoonCard
            title="不具合報告管理"
            description="テストプレイ中の不具合報告、要望、対応状況を管理します。"
          />
        )}

        {canManagePermissions(role) && (
          <NavigationCard
            href="/admin/permissions"
            title="権限管理"
            description="admin / editor / support の付与・変更・削除を行います。"
          />
        )}

        {canViewSupportTools(role) && (
          <ComingSoonCard
            title="ルーム管理"
            description="進行中ルーム、参加者、観戦者、高負荷ルームを確認します。"
          />
        )}

        {canViewSupportTools(role) && (
          <ComingSoonCard
            title="ログ確認"
            description="高負荷操作やエラーの確認を行います。通常の非公開操作内容は保存しません。"
          />
        )}

        {canManageCards(role) && (
          <ComingSoonCard
            title="カード管理"
            description="登録済みカードの検索、分類、重複確認、正式画像差し替えを行います。"
          />
        )}
      </div>
    </main>
  );
}
