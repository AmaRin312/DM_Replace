"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { getOrCreateProfile } from "@/lib/auth/getOrCreateProfile";

type DeckSnapshotCard = {
  slotIndex: number;
  cardName: string;
  isProxy: boolean;
};

type DeckSnapshot = {
  deckName: string;
  cards: DeckSnapshotCard[];
};

export default function DeckCodePage() {
  const [code, setCode] = useState("");
  const [snapshot, setSnapshot] = useState<DeckSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadDeckCode() {
    setLoading(true);
    setMessage("");
    setSnapshot(null);

    try {
      const normalizedCode = code.trim().toUpperCase();

      if (!normalizedCode) {
        setMessage("デッキコードを入力してください。");
        return;
      }

      const { data, error } = await supabase
        .from("deck_codes")
        .select("deck_snapshot, expires_at")
        .eq("code", normalizedCode)
        .maybeSingle();

      if (error) {
        console.error(error);
        setMessage("デッキコードの読み込みに失敗しました。");
        return;
      }

      if (!data) {
        setMessage("デッキコードが見つかりません。");
        return;
      }

      if (new Date(data.expires_at).getTime() <= Date.now()) {
        setMessage("このデッキコードは期限切れです。");
        return;
      }

      const loadedSnapshot = data.deck_snapshot as DeckSnapshot;

      if (!loadedSnapshot.cards || loadedSnapshot.cards.length !== 40) {
        setMessage("デッキ内容が正しくありません。");
        return;
      }

      setSnapshot(loadedSnapshot);
      setMessage("デッキを読み込みました。保存しない場合、このデッキは残りません。");
    } finally {
      setLoading(false);
    }
  }

  async function saveLoadedDeck() {
    if (!snapshot || saving) return;

    setSaving(true);
    setMessage("");

    try {
      const profile = await getOrCreateProfile();

      if (!profile) {
        setMessage("ログイン情報を確認できませんでした。");
        return;
      }

      if (snapshot.cards.length !== 40) {
        setMessage("40枚のデッキのみ保存できます。");
        return;
      }

      const { data: deck, error: deckError } = await supabase
        .from("decks")
        .insert({
          owner_id: profile.id,
          name: `${snapshot.deckName} のコピー`
        })
        .select("id")
        .single();

      if (deckError || !deck) {
        console.error(deckError);
        setMessage("デッキ保存に失敗しました。");
        return;
      }

      const deckCards = snapshot.cards
        .sort((a, b) => a.slotIndex - b.slotIndex)
        .map((card, index) => ({
          deck_id: deck.id,
          slot_index: index,
          card_id: null,
          card_name: card.cardName,
          is_proxy: card.isProxy
        }));

      const { error: cardsError } = await supabase
        .from("deck_cards")
        .insert(deckCards);

      if (cardsError) {
        console.error(cardsError);
        setMessage("デッキ内カードの保存に失敗しました。");
        return;
      }

      setMessage("自分の保存済みデッキとして保存しました。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page">
      <h1>デッキコードで作成</h1>
      <p className="muted">D-XXXXXX を入力して、共有されたデッキを確認します。</p>

      <div style={{ display: "grid", gap: 12, maxWidth: 520, marginBottom: 20 }}>
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="例：D-ABC123"
        />

        <button onClick={loadDeckCode} disabled={loading}>
          {loading ? "読み込み中..." : "デッキコードを読み込む"}
        </button>

        <a href="/decks">デッキ管理へ戻る</a>
      </div>

      {message && <p className="muted">{message}</p>}

      {snapshot && (
        <>
          <section
            style={{
              border: "1px solid #444",
              borderRadius: 12,
              padding: 16,
              marginBottom: 20,
              background: "#1f1f1f"
            }}
          >
            <h2>{snapshot.deckName}</h2>
            <p className="muted">保存しない場合、このデッキは画面を離れると残りません。</p>

            <button onClick={saveLoadedDeck} disabled={saving}>
              {saving ? "保存中..." : "このデッキを保存"}
            </button>
          </section>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 10
            }}
          >
            {snapshot.cards
              .slice()
              .sort((a, b) => a.slotIndex - b.slotIndex)
              .map((card) => (
                <section
                  key={card.slotIndex}
                  style={{
                    display: "grid",
                    gap: 6,
                    padding: 10,
                    border: "1px solid #444",
                    borderRadius: 10,
                    background: card.isProxy ? "#050505" : "#1f1f1f",
                    color: card.isProxy ? "#fff" : "inherit",
                    aspectRatio: "63 / 88",
                    alignContent: "center",
                    textAlign: "center"
                  }}
                >
                  <span className="muted">{card.slotIndex + 1}枚目</span>
                  {card.isProxy && <strong>PROXY</strong>}
                  <strong>{card.cardName}</strong>
                </section>
              ))}
          </div>
        </>
      )}
    </main>
  );
}