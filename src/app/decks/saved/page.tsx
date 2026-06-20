"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { getOrCreateProfile } from "@/lib/auth/getOrCreateProfile";

type SavedDeck = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export default function SavedDecksPage() {
  const [decks, setDecks] = useState<SavedDeck[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadDecks() {
    setLoading(true);
    setMessage("");

    const profile = await getOrCreateProfile();

    if (!profile) {
      setMessage("ログイン情報を確認できませんでした。");
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("decks")
      .select("id, name, created_at, updated_at")
      .eq("owner_id", profile.id)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error(error);
      setMessage("保存済みデッキの読み込みに失敗しました。");
      setLoading(false);
      return;
    }

    setDecks(data ?? []);
    setLoading(false);
  }

  async function deleteDeck(deckId: string) {
    const ok = window.confirm("このデッキを削除しますか？");
    if (!ok) return;

    const { error } = await supabase
      .from("decks")
      .delete()
      .eq("id", deckId);

    if (error) {
      console.error(error);
      setMessage("削除に失敗しました。");
      return;
    }

    setMessage("デッキを削除しました。");
    loadDecks();
  }

  useEffect(() => {
    loadDecks();
  }, []);

  return (
    <main className="page">
      <h1>保存済みデッキ</h1>
      <p className="muted">保存したデッキを確認できます。</p>

      <p>
        <a href="/decks">デッキ管理へ戻る</a>
      </p>

      {message && <p className="muted">{message}</p>}

      {loading ? (
        <p className="muted">読み込み中...</p>
      ) : decks.length === 0 ? (
        <p className="muted">保存済みデッキはまだありません。</p>
      ) : (
        <div className="grid">
          {decks.map((deck) => (
            <section
              key={deck.id}
              style={{
                border: "1px solid #444",
                borderRadius: 12,
                padding: 16,
                background: "#1f1f1f",
                display: "grid",
                gap: 10
              }}
            >
              <h2 style={{ margin: 0 }}>{deck.name}</h2>
              <p className="muted" style={{ margin: 0 }}>
                更新日：{new Date(deck.updated_at).toLocaleString("ja-JP")}
              </p>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <a href={`/decks/saved/${deck.id}`}>詳細を見る</a>
                <button onClick={() => deleteDeck(deck.id)}>削除</button>
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}