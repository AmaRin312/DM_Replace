"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NavigationCard } from "@/components/layout/NavigationCard";
import { getOrCreateProfile } from "@/lib/auth/getOrCreateProfile";
import type { Profile } from "@/types/profile";

export default function HomePage() {
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function setupProfile() {
  const result = await getOrCreateProfile();

  if (
    result &&
    (!result.nickname || result.nickname === "名無し")
  ) {
    router.push("/profile");
    return;
  }

  setProfile(result);
  setLoading(false);
}

    setupProfile();
  }, []);

  if (loading) {
    return (
      <main className="page">
        <h1>読み込み中...</h1>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="page">
        <h1>ログイン情報を確認できませんでした</h1>
        <p className="muted">もう一度ログインしてください。</p>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>ホーム</h1>
      <p className="muted">ようこそ、{profile.nickname ?? "名無し"} さん</p>

{profile.role === "owner" && (
  <p className="muted">管理者権限：owner</p>
)}
      
      <div className="grid">
  <NavigationCard
    href="/profile"
    title="プロフィール設定"
    description="ニックネームを変更します。"
  />

        <NavigationCard
          href="/decks"
          title="デッキ管理"
          description="新規作成、保存済みデッキ、デッキコード読み込み"
        />
        <NavigationCard
          href="/rooms"
          title="ルーム"
          description="対戦ルーム作成、入室、観戦"
        />
        <NavigationCard
          href="/other"
          title="その他"
          description="重要お知らせ、利用規約"
        />
      </div>
    </main>
  );
}