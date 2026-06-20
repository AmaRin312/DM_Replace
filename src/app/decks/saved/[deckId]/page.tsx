"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getOrCreateProfile } from "@/lib/auth/getOrCreateProfile";

type Deck = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type DeckCard = {
  id: string;
  slot_index: number;
  card_id: string | null;
  card_name: string;
  image_url: string | null;
  thumbnail_url?: string | null;
  is_proxy: boolean;
};

type CardMasterRow = {
  id: string;
  name: string;
  image_url: string | null;
  thumbnail_url: string | null;
};

type DeckSlot = {
  originalDeckCardId: string | null;
  cardName: string;
  cardId: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  isProxy: boolean;
};

const MAX_DISPLAY_SLOTS = 48;

function createRandomDeckCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const random = Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");

  return `D-${random}`;
}

async function createUniqueDeckCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = createRandomDeckCode();

    const { data, error } = await supabase
      .from("deck_codes")
      .select("id")
      .eq("code", code)
      .maybeSingle();

    if (error) {
      console.error(error);
      throw new Error("デッキコード確認に失敗しました。");
    }

    if (!data) {
      return code;
    }
  }

  throw new Error("デッキコードの作成に失敗しました。もう一度お試しください。");
}

function createEmptySlot(originalDeckCardId: string | null = null): DeckSlot {
  return {
    originalDeckCardId,
    cardName: "",
    cardId: null,
    imageUrl: null,
    thumbnailUrl: null,
    isProxy: true
  };
}

function normalizeCardNameForLookup(name: string) {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0)
    );
}

function createProxySlot(cardName: string): DeckSlot {
  return {
    originalDeckCardId: null,
    cardName,
    cardId: null,
    imageUrl: null,
    thumbnailUrl: null,
    isProxy: true
  };
}

function createSlotFromMaster(card: CardMasterRow): DeckSlot {
  return {
    originalDeckCardId: null,
    cardName: card.name,
    cardId: card.id,
    imageUrl: card.image_url,
    thumbnailUrl: card.thumbnail_url ?? card.image_url,
    isProxy: false
  };
}

function createCopies(slot: DeckSlot, count: number) {
  return Array.from({ length: count }, () => ({
    ...slot,
    originalDeckCardId: null
  }));
}

function createDisplaySlots(slots: DeckSlot[]) {
  const baseLength = slots.length > 40 ? 48 : 40;
  const emptyCount = Math.max(0, baseLength - slots.length);

  return [
    ...slots,
    ...Array.from({ length: emptyCount }, () => createEmptySlot())
  ].slice(0, baseLength);
}

async function getMasterMapByNames(names: string[]) {
  const uniqueNames = Array.from(
    new Set(names.map((name) => normalizeCardNameForLookup(name)).filter(Boolean))
  );

  const masterMap = new Map<string, CardMasterRow>();

  if (uniqueNames.length === 0) return masterMap;

  const { data, error } = await supabase
    .from("cards")
    .select("id, name, image_url, thumbnail_url")
    .in("name", uniqueNames);

  if (error) {
    console.warn("cards テーブルの画像参照に失敗しました。", error);
    return masterMap;
  }

  ((data ?? []) as CardMasterRow[]).forEach((card) => {
    masterMap.set(normalizeCardNameForLookup(card.name), card);
  });

  return masterMap;
}

async function applyMasterImages(deckCards: DeckCard[]) {
  const masterMap = await getMasterMapByNames(
    deckCards.map((card) => card.card_name)
  );

  return deckCards.map((deckCard) => {
    const masterCard = masterMap.get(normalizeCardNameForLookup(deckCard.card_name));

    return {
      ...deckCard,
      card_id: deckCard.card_id ?? masterCard?.id ?? null,
      image_url: masterCard?.image_url ?? deckCard.image_url ?? null,
      thumbnail_url:
        masterCard?.thumbnail_url ??
        deckCard.thumbnail_url ??
        deckCard.image_url ??
        null,
      is_proxy: masterCard ? false : deckCard.is_proxy
    };
  });
}

function createSlotsFromDeckCards(cards: DeckCard[]): DeckSlot[] {
  const sorted = [...cards].sort((a, b) => a.slot_index - b.slot_index);
  const slots: DeckSlot[] = sorted.map((card) => ({
    originalDeckCardId: card.id,
    cardName: card.card_name,
    cardId: card.card_id,
    imageUrl: card.image_url,
    thumbnailUrl: card.thumbnail_url ?? card.image_url,
    isProxy: card.is_proxy
  }));

  while (slots.length < 40) {
    slots.push(createEmptySlot());
  }

  return slots.slice(0, 40);
}

export default function SavedDeckDetailPage() {
  const params = useParams();
  const rawDeckId = params.deckId;
  const deckId = Array.isArray(rawDeckId) ? rawDeckId[0] : rawDeckId;

  const [deck, setDeck] = useState<Deck | null>(null);
  const [deckName, setDeckName] = useState("");
  const [originalCards, setOriginalCards] = useState<DeckCard[]>([]);
  const [slots, setSlots] = useState<DeckSlot[]>([]);
  const [registeredCards, setRegisteredCards] = useState<CardMasterRow[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [manualName, setManualName] = useState("");
  const [cardQuery, setCardQuery] = useState("");
  const [targetCount, setTargetCount] = useState(1);
  const [message, setMessage] = useState("");
  const [deckCode, setDeckCode] = useState("");
  const [creatingCode, setCreatingCode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingCards, setLoadingCards] = useState(true);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [searchPopupOpen, setSearchPopupOpen] = useState(false);

  const filledSlots = slots.filter((slot) => slot.cardName.trim());
  const filledCount = filledSlots.length;
  const displaySlots = useMemo(() => createDisplaySlots(slots), [slots]);
  const editingSlot =
    editingIndex === null ? null : slots[editingIndex] ?? createEmptySlot();
  const editingSlotHasCard = Boolean(editingSlot?.cardName.trim());

  const filteredRegisteredCards = useMemo(() => {
    const query = normalizeCardNameForLookup(cardQuery);

    if (!query) {
      return registeredCards.slice(0, 10);
    }

    return registeredCards
      .filter((card) => normalizeCardNameForLookup(card.name).includes(query))
      .slice(0, 10);
  }, [registeredCards, cardQuery]);

  async function loadRegisteredCards() {
    setLoadingCards(true);

    const { data, error } = await supabase
      .from("cards")
      .select("id, name, image_url, thumbnail_url")
      .order("name", { ascending: true })
      .limit(1000);

    if (error) {
      console.warn("登録済みカード一覧の読み込みに失敗しました。", error);
      setRegisteredCards([]);
      setLoadingCards(false);
      return;
    }

    setRegisteredCards((data ?? []) as CardMasterRow[]);
    setLoadingCards(false);
  }

  async function loadDeck() {
    if (!deckId) {
      setMessage("デッキIDを確認できませんでした。");
      setLoading(false);
      return;
    }

    setLoading(true);
    setMessage("");

    const profile = await getOrCreateProfile();

    if (!profile) {
      setMessage("ログイン情報を確認できませんでした。");
      setLoading(false);
      return;
    }

    const { data: deckData, error: deckError } = await supabase
      .from("decks")
      .select("id, name, created_at, updated_at")
      .eq("id", deckId)
      .eq("owner_id", profile.id)
      .maybeSingle();

    if (deckError) {
      console.error(deckError);
      setMessage("デッキ情報の読み込みに失敗しました。");
      setLoading(false);
      return;
    }

    if (!deckData) {
      setMessage("デッキが見つかりません。");
      setLoading(false);
      return;
    }

    const { data: cardData, error: cardError } = await supabase
      .from("deck_cards")
      .select("id, slot_index, card_id, card_name, image_url, thumbnail_url, is_proxy")
      .eq("deck_id", deckId)
      .order("slot_index", { ascending: true });

    if (cardError) {
      console.error(cardError);
      setMessage("カード情報の読み込みに失敗しました。deck_cards に thumbnail_url 列が無い場合はSQLを実行してください。");
      setLoading(false);
      return;
    }

    const nextCards = await applyMasterImages((cardData ?? []) as DeckCard[]);

    setDeck(deckData as Deck);
    setDeckName((deckData as Deck).name);
    setOriginalCards(nextCards);
    setSlots(createSlotsFromDeckCards(nextCards));
    await loadRegisteredCards();
    setLoading(false);
  }

  function countSameCardsNear(index: number) {
    const target = slots[index];

    if (!target?.cardName.trim()) return 1;

    const key = normalizeCardNameForLookup(target.cardName);
    let count = 0;

    for (let i = index; i < slots.length; i += 1) {
      if (normalizeCardNameForLookup(slots[i]?.cardName ?? "") !== key) break;
      count += 1;
    }

    return Math.max(1, count);
  }

  function openEditor(index: number) {
    const slot = slots[index] ?? createEmptySlot();

    setEditingIndex(index);
    setManualName(slot.cardName);
    setTargetCount(slot.cardName ? countSameCardsNear(index) : 1);
    setCardQuery("");
    setMessage("");
  }

  function closeEditor() {
    setEditingIndex(null);
    setManualName("");
    setTargetCount(1);
    setCardQuery("");
    setSearchPopupOpen(false);
  }

  function replaceSlot(index: number, nextSlot: DeckSlot) {
    setSlots((current) => {
      const next = [...current];

      while (next.length <= index) {
        next.push(createEmptySlot());
      }

      next[index] = {
        ...nextSlot,
        originalDeckCardId: next[index]?.originalDeckCardId ?? null
      };

      return next;
    });
  }

  function applyCardToEditingSlot(slot: DeckSlot, closeAfter = false) {
    if (editingIndex === null) return;

    replaceSlot(editingIndex, slot);
    setManualName(slot.cardName);
    setTargetCount(1);
    setDeckCode("");
    setMessage(`${editingIndex + 1}枚目に「${slot.cardName}」を入れました。`);

    if (closeAfter) {
      closeEditor();
    }
  }

  function applyManualName() {
    const name = manualName.trim();

    if (!name) {
      setMessage("カード名を入力してください。");
      return;
    }

    applyCardToEditingSlot(createProxySlot(name));
  }

  function applyRegisteredCard(card: CardMasterRow) {
    applyCardToEditingSlot(createSlotFromMaster(card), true);
    setSearchPopupOpen(false);
  }

  function clearEditingSlot() {
    if (editingIndex === null) return;

    setSlots((current) => {
      const next = [...current];

      if (editingIndex < next.length) {
        next.splice(editingIndex, 1);
      }

      while (next.length < 40) {
        next.push(createEmptySlot());
      }

      return next;
    });

    setDeckCode("");
    setMessage(`${editingIndex + 1}枚目を削除し、後ろのカードを前へ詰めました。`);
    closeEditor();
  }

  function decreaseTargetCount() {
    setTargetCount((current) => Math.max(0, current - 1));
  }

  function increaseTargetCount() {
    setTargetCount((current) => Math.min(MAX_DISPLAY_SLOTS, current + 1));
  }

  function applyCountChange() {
    if (editingIndex === null) return;

    const nextCount = targetCount;
    const baseSlot = slots[editingIndex] ?? createProxySlot(manualName.trim());

    if (!baseSlot.cardName.trim() && nextCount > 0) {
      setMessage("先にカード名を入力するか、登録済みカードを選択してください。");
      return;
    }

    setSlots((current) => {
      const next = [...current];
      const key = normalizeCardNameForLookup(baseSlot.cardName);
      let currentCount = 0;

      for (let i = editingIndex; i < next.length; i += 1) {
        if (normalizeCardNameForLookup(next[i]?.cardName ?? "") !== key) break;
        currentCount += 1;
      }

      if (currentCount === 0) currentCount = 1;

      next.splice(
        editingIndex,
        currentCount,
        ...createCopies(baseSlot, nextCount)
      );

      while (next.length < 40) {
        next.push(createEmptySlot());
      }

      return next.slice(0, MAX_DISPLAY_SLOTS);
    });

    setDeckCode("");
    setMessage(
      nextCount === 0
        ? "選択カードを削除しました。"
        : `選択カードを${nextCount}枚にしました。40枚ぴったりで保存できます。`
    );

    closeEditor();
  }

  function moveSlot(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;

    setSlots((current) => {
      const next = [...current];

      while (next.length <= Math.max(fromIndex, toIndex)) {
        next.push(createEmptySlot());
      }

      const [moved] = next.splice(fromIndex, 1);

      if (!moved || !moved.cardName.trim()) {
        return current;
      }

      next.splice(toIndex, 0, moved);

      while (next.length < 40) {
        next.push(createEmptySlot());
      }

      return next.slice(0, MAX_DISPLAY_SLOTS);
    });

    setDeckCode("");
    setMessage(`${fromIndex + 1}枚目を${toIndex + 1}枚目へ移動しました。`);
  }

  async function saveDeck() {
    if (saving || !deckId) return;

    setSaving(true);
    setMessage("");

    try {
      const trimmedDeckName = deckName.trim();

      if (!trimmedDeckName) {
        setMessage("デッキ名を入力してください。");
        return;
      }

      const normalizedSlots = slots
        .filter((slot) => slot.cardName.trim())
        .map((slot) => ({
          ...slot,
          cardName: slot.cardName.trim()
        }));

      if (normalizedSlots.length !== 40) {
        setMessage(`デッキは40枚ぴったりで保存してください。現在 ${normalizedSlots.length} / 40 枚です。`);
        return;
      }

      const existingRows = [...originalCards].sort((a, b) => a.slot_index - b.slot_index);

      if (existingRows.length !== 40) {
        setMessage("既存デッキの40枠を確認できません。再読み込みしてください。");
        return;
      }

      const masterMap = await getMasterMapByNames(
        normalizedSlots.map((slot) => slot.cardName)
      );

      const updateResults = await Promise.all(
        normalizedSlots.map((slot, index) => {
          const existingRow = existingRows[index];
          const masterCard = masterMap.get(normalizeCardNameForLookup(slot.cardName));

          return supabase
            .from("deck_cards")
            .update({
              slot_index: index,
              card_name: slot.cardName,
              card_id: masterCard?.id ?? slot.cardId ?? null,
              image_url: masterCard?.image_url ?? slot.imageUrl ?? null,
              thumbnail_url:
                masterCard?.thumbnail_url ??
                masterCard?.image_url ??
                slot.thumbnailUrl ??
                slot.imageUrl ??
                null,
              is_proxy: !masterCard && slot.isProxy
            })
            .eq("id", existingRow.id)
            .eq("deck_id", deckId);
        })
      );

      const failed = updateResults.find((result) => result.error);

      if (failed?.error) {
        console.error(failed.error);
        setMessage(`デッキ内容の保存に失敗しました：${failed.error.message}`);
        return;
      }

      const { error: deckUpdateError } = await supabase
        .from("decks")
        .update({
          name: trimmedDeckName,
          updated_at: new Date().toISOString()
        })
        .eq("id", deckId);

      if (deckUpdateError) {
        console.error(deckUpdateError);
        setMessage(`デッキ名の保存に失敗しました：${deckUpdateError.message}`);
        return;
      }

      setDeckCode("");
      setMessage("デッキ内容を保存しました。");
      await loadDeck();
    } finally {
      setSaving(false);
    }
  }

  async function showDeckCode() {
    if (!deck || creatingCode) return;

    setCreatingCode(true);
    setMessage("");

    try {
      const profile = await getOrCreateProfile();

      if (!profile) {
        setMessage("ログイン情報を確認できませんでした。");
        return;
      }

      const { data: existingCode, error: existingError } = await supabase
        .from("deck_codes")
        .select("code")
        .eq("source_deck_id", deck.id)
        .eq("created_by", profile.id)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (existingError) {
        console.error(existingError);
        setMessage("デッキコード確認に失敗しました。");
        return;
      }

      if (existingCode) {
        setDeckCode(existingCode.code);
        return;
      }

      const snapshotCards = slots
        .filter((slot) => slot.cardName.trim())
        .slice(0, 40)
        .map((slot, index) => ({
          slotIndex: index,
          cardId: slot.cardId,
          cardName: slot.cardName,
          imageUrl: slot.imageUrl,
          thumbnailUrl: slot.thumbnailUrl,
          isProxy: slot.isProxy
        }));

      if (snapshotCards.length !== 40) {
        setMessage("デッキコードは40枚ぴったりのデッキで作成してください。");
        return;
      }

      const snapshot = {
        deckName: deckName.trim() || deck.name,
        cards: snapshotCards
      };

      const newCode = await createUniqueDeckCode();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      const { data: insertedCode, error: insertError } = await supabase
        .from("deck_codes")
        .insert({
          code: newCode,
          source_deck_id: deck.id,
          created_by: profile.id,
          deck_snapshot: snapshot,
          expires_at: expiresAt
        })
        .select("code")
        .single();

      if (insertError) {
        console.error(insertError);
        setMessage("デッキコードの作成に失敗しました。もう一度お試しください。");
        return;
      }

      setDeckCode(insertedCode.code);
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error
          ? error.message
          : "デッキコード作成中に予期しないエラーが発生しました。"
      );
    } finally {
      setCreatingCode(false);
    }
  }

  useEffect(() => {
    void loadDeck();
  }, [deckId]);

  if (loading) {
    return (
      <main className="replace-page">
        <section className="replace-shell">
          <section className="replace-panel">
            <h1>読み込み中...</h1>
          </section>
        </section>
      </main>
    );
  }

  if (!deck) {
    return (
      <main className="replace-page">
        <section className="replace-shell">
          <section className="replace-panel">
            <h1>デッキ詳細</h1>
            <p className="replace-sub">{message || "デッキが見つかりません。"}</p>
            <Link href="/decks/saved" className="soft-link" style={{ width: "fit-content" }}>
              保存済みデッキへ戻る
            </Link>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="replace-page">
      <section className="replace-shell deck-shell">
        {message && <section className="replace-message">{message}</section>}

        {deckCode && (
          <section className="replace-panel compact deck-code-panel">
            <span>このコードは1時間有効です。</span>
            <strong>{deckCode}</strong>
          </section>
        )}

        <section className="deck-editor-layout">
          <section className="replace-panel deck-board-panel">
            <div
              className="deck-grid"
              style={{
                gridTemplateRows: `repeat(${displaySlots.length > 40 ? 6 : 5}, 1fr)`
              }}
            >
              {displaySlots.map((slot, index) => {
                const imageUrl = slot.thumbnailUrl ?? slot.imageUrl;
                const filled = Boolean(slot.cardName.trim());
                const dragOver = dragOverIndex === index;

                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => openEditor(index)}
                    draggable={filled}
                    onDragStart={() => {
                      if (filled) setDragIndex(index);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOverIndex(index);
                    }}
                    onDragLeave={() => setDragOverIndex(null)}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragIndex === null) return;
                      moveSlot(dragIndex, index);
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    className={`deck-card-button ${dragOver ? "drag-over" : ""}`}
                    style={{
                      opacity: dragIndex === index ? 0.55 : 1
                    }}
                  >
                    <div className="deck-card-face">
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={slot.cardName}
                          loading="lazy"
                        />
                      ) : (
                        <span>
                          {slot.cardName ? "PROXY" : index + 1}
                        </span>
                      )}
                    </div>

                    <strong title={slot.cardName || `${index + 1}枚目`}>
                      {slot.cardName || "空き"}
                    </strong>
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="replace-panel deck-side-panel">
            <div>
              <p className="replace-kicker">SAVED DECK</p>
              <h2 style={{ margin: 0 }}>デッキ編集</h2>
              <p className="replace-sub side-text">
                カードをクリックして編集します。40枚超過時だけ6段目が表示されます。
              </p>
            </div>

            <label className="replace-label">
              デッキ名
              <input
                value={deckName}
                onChange={(event) => {
                  setDeckName(event.target.value);
                  setDeckCode("");
                }}
                placeholder="デッキ名"
              />
            </label>

            <section
              className="deck-count-box"
              data-over={filledCount > 40 ? "true" : "false"}
              data-ok={filledCount === 40 ? "true" : "false"}
            >
              <strong>{filledCount} / 40 枚</strong>
              <span>
                {filledCount === 40
                  ? "保存できます。"
                  : filledCount > 40
                    ? `${filledCount - 40}枚削除してください。`
                    : `${40 - filledCount}枚追加してください。`}
              </span>
            </section>

            <button className="replace-button primary" onClick={saveDeck} disabled={saving || filledCount !== 40}>
              {saving ? "保存中..." : "編集を保存"}
            </button>

            <button className="replace-button secondary" onClick={showDeckCode} disabled={creatingCode || filledCount !== 40}>
              {creatingCode ? "作成中..." : "デッキコードを表示"}
            </button>

            <div className="replace-actions">
              <Link href="/decks/saved" className="soft-link">保存済み</Link>
              <Link href="/decks" className="soft-link">デッキ管理</Link>
              <Link href="/cards/images" className="soft-link">カード登録</Link>
              <Link href="/home" className="soft-link">ホーム</Link>
            </div>

            <p className="replace-mini">
              ドラッグして別の枠へ落とすと、その位置に挿入され、後ろのカードがずれます。
            </p>
          </aside>
        </section>
      </section>

      {editingIndex !== null && (
        <section
          className="deck-modal-backdrop"
          onClick={closeEditor}
        >
          <div
            className="deck-edit-modal replace-panel"
            onClick={(event) => event.stopPropagation()}
          >
            {editingSlotHasCard && (
              <button
                type="button"
                className="modal-delete-button"
                onClick={clearEditingSlot}
                title="このカードを削除"
              >
                削除
              </button>
            )}

            <button
              type="button"
              className="modal-close-button"
              onClick={closeEditor}
              title="閉じる"
            >
              ×
            </button>

            <div>
              <p
                className="replace-sub modal-sub"
                style={{ margin: 0 }}
              >
                {editingSlotHasCard
                  ? editingSlot?.cardName
                  : "空き枠です。カード検索またはプロキシ名入力で追加できます。"}
              </p>
            </div>

            <div className="modal-card-preview">
              {editingSlot?.imageUrl || editingSlot?.thumbnailUrl ? (
                <img
                  src={editingSlot.imageUrl ?? editingSlot.thumbnailUrl ?? ""}
                  alt={editingSlot.cardName || "カード画像"}
                />
              ) : (
                <div>
                  <strong>{editingSlot?.cardName || "NO CARD"}</strong>
                  <span>{editingSlotHasCard ? "PROXY" : "空き枠"}</span>
                </div>
              )}
            </div>

            {(!editingSlotHasCard || editingSlot?.isProxy) && (
              <label className="replace-label modal-label">
                プロキシのカード名
                <input
                  value={manualName}
                  onChange={(event) => setManualName(event.target.value)}
                  placeholder="カード名を入力"
                />
              </label>
            )}

            {(!editingSlotHasCard || editingSlot?.isProxy) && (
              <button type="button" className="replace-button primary modal-button" onClick={applyManualName}>
                このカード名を反映
              </button>
            )}

            {editingSlotHasCard && (
              <section className="count-control">
                <span>枚数</span>
                <button type="button" onClick={decreaseTargetCount}>−</button>
                <strong>{targetCount}</strong>
                <button type="button" onClick={increaseTargetCount}>＋</button>
                <button type="button" className="apply-count" onClick={applyCountChange}>
                  反映
                </button>
              </section>
            )}

            <hr className="modal-line" />

            <label className="replace-label modal-label">
              登録済みカード検索
              <input
                value={cardQuery}
                onChange={(event) => {
                  setCardQuery(event.target.value);
                  setSearchPopupOpen(true);
                }}
                onFocus={() => setSearchPopupOpen(true)}
                placeholder="カード名で検索"
              />
            </label>
          </div>
        </section>
      )}

      {editingIndex !== null && searchPopupOpen && (
        <section
          className="card-search-backdrop"
          onClick={() => setSearchPopupOpen(false)}
        >
          <div
            className="card-search-popup replace-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="card-search-head">
              <div>
                <p className="replace-kicker">SEARCH</p>
                <h2>カード候補</h2>
              </div>

              <button
                type="button"
                className="search-close-button"
                onClick={() => setSearchPopupOpen(false)}
              >
                閉じる
              </button>
            </div>

            <label className="replace-label modal-label">
              カード名検索
              <input
                value={cardQuery}
                onChange={(event) => setCardQuery(event.target.value)}
                placeholder="カード名で検索"
                autoFocus
              />
            </label>

            <div className="search-result-list">
              {loadingCards ? (
                <p className="replace-sub modal-small">読み込み中...</p>
              ) : filteredRegisteredCards.length === 0 ? (
                <p className="replace-sub modal-small">該当カードがありません。</p>
              ) : (
                filteredRegisteredCards.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    className="search-result-button"
                    onClick={() => applyRegisteredCard(card)}
                    title={card.name}
                  >
                    <span className="search-result-thumb">
                      {card.thumbnail_url || card.image_url ? (
                        <img
                          src={card.thumbnail_url ?? card.image_url ?? ""}
                          alt={card.name}
                          loading="lazy"
                        />
                      ) : (
                        "🃏"
                      )}
                    </span>
                    <strong>{card.name}</strong>
                  </button>
                ))
              )}
            </div>
          </div>
        </section>
      )}

      <style jsx>{`
        .deck-shell {
          max-width: 1500px;
          gap: 14px;
        }

        .deck-editor-layout {
          display: grid;
          grid-template-columns: minmax(760px, 1fr) 360px;
          gap: 18px;
          align-items: start;
        }

        .deck-board-panel {
          padding: 16px;
          overflow: hidden;
        }

        .deck-grid {
          display: grid;
          grid-template-columns: repeat(8, 1fr);
          gap: 8px;
          width: 100%;
          height: min(84vh, 860px);
          min-height: 560px;
        }

        .deck-card-button {
          min-width: 0;
          min-height: 0;
          padding: 5px;
          border: 1px solid rgba(147, 197, 253, .82);
          border-radius: 12px;
          background: rgba(255, 255, 255, .94);
          color: #172554;
          display: grid;
          grid-template-rows: 1fr auto;
          gap: 4px;
          overflow: hidden;
          cursor: pointer;
          box-shadow: 0 8px 18px rgba(59, 130, 246, .08);
        }

        .deck-card-button.drag-over {
          border: 3px solid #60a5fa;
          background: rgba(219, 234, 254, .98);
          box-shadow: 0 0 0 4px rgba(147, 197, 253, .28);
        }

        .deck-card-face {
          aspect-ratio: 3 / 4;
          min-height: 0;
          border: 1px dashed rgba(96, 165, 250, .58);
          border-radius: 9px;
          background: rgba(239, 246, 255, .9);
          display: grid;
          place-items: center;
          overflow: hidden;
        }

        .deck-card-face img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .deck-card-face span {
          font-size: 10px;
          color: #1d4ed8;
          font-weight: 800;
        }

        .deck-card-button strong {
          font-size: 10px;
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .deck-side-panel {
          position: sticky;
          top: 14px;
          padding: 20px;
        }

        .side-text {
          font-size: 15px;
          line-height: 1.55;
        }

        .deck-count-box {
          border: 1px solid rgba(147, 197, 253, .72);
          border-radius: 18px;
          padding: 14px;
          background: rgba(239, 246, 255, .84);
          display: grid;
          gap: 4px;
        }

        .deck-count-box strong {
          color: #1d4ed8;
          font-size: 26px;
        }

        .deck-count-box span {
          color: #64748b;
          font-size: 14px;
        }

        .deck-count-box[data-ok="true"] {
          border-color: rgba(34, 197, 94, .55);
          background: rgba(220, 252, 231, .8);
        }

        .deck-count-box[data-ok="true"] strong {
          color: #166534;
        }

        .deck-count-box[data-over="true"] {
          border-color: rgba(251, 113, 133, .62);
          background: rgba(255, 228, 230, .82);
        }

        .deck-count-box[data-over="true"] strong {
          color: #be123c;
        }

        .deck-code-panel {
          display: flex;
          justify-content: space-between;
          gap: 14px;
          align-items: center;
        }

        .deck-code-panel span {
          color: #64748b;
          font-size: 14px;
        }

        .deck-code-panel strong {
          color: #1d4ed8;
          font-size: 28px;
          letter-spacing: .06em;
        }

        .deck-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 100;
          display: grid;
          place-items: center;
          padding: 20px;
          background: rgba(15, 23, 42, .42);
          backdrop-filter: blur(8px);
        }

        .deck-edit-modal {
          position: relative;
          width: min(720px, 100%);
          max-height: 88vh;
          overflow: hidden;
          padding: 20px;
          gap: 10px;
        }

        .deck-edit-modal h2 {
          margin: 0;
          font-size: 28px;
        }

        .modal-sub {
          font-size: 14px;
          line-height: 1.55;
        }

        .modal-card-preview {
          width: min(264px, 78vw);
          aspect-ratio: 3 / 4;
          justify-self: center;
          border: 1px solid rgba(96, 165, 250, .62);
          border-radius: 18px;
          background: rgba(239, 246, 255, .88);
          display: grid;
          place-items: center;
          overflow: hidden;
          box-shadow: 0 12px 28px rgba(59, 130, 246, .12);
        }

        .modal-card-preview img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .modal-card-preview div {
          width: 100%;
          height: 100%;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 8px;
          padding: 16px;
          text-align: center;
          color: #1d4ed8;
        }

        .modal-card-preview strong {
          font-size: 18px;
          line-height: 1.35;
          word-break: break-word;
        }

        .modal-card-preview span {
          font-size: 13px;
          font-weight: 900;
          color: #64748b;
        }

        .modal-label {
          font-size: 14px;
          gap: 5px;
        }

        .modal-label input {
          font-size: 14px;
          padding: 9px 10px;
          border-radius: 12px;
        }

        .modal-button {
          font-size: 14px;
          padding: 9px 12px;
          border-radius: 12px;
        }

        .modal-delete-button {
          position: absolute;
          top: 24px;
          right: 50px;
          border: 1px solid rgba(251, 113, 133, .58);
          border-radius: 999px;
          padding: 7px 11px;
          background: rgba(255, 228, 230, .92);
          color: #be123c;
          font-size: 13px;
          font-weight: 900;
          cursor: pointer;
        }

        .modal-close-button {
          position: absolute;
          top: 24px;
          right: 12px;
          width: 30px;
          height: 30px;
          border: 1px solid rgba(147, 197, 253, .72);
          border-radius: 999px;
          background: rgba(255, 255, 255, .92);
          color: #1d4ed8;
          font-size: 18px;
          font-weight: 900;
          line-height: 1;
          cursor: pointer;
        }

        .count-control {
          display: grid;
          grid-template-columns: auto 42px 56px 42px auto;
          gap: 8px;
          align-items: center;
          justify-content: start;
          border: 1px solid rgba(147, 197, 253, .72);
          border-radius: 16px;
          padding: 10px;
          background: rgba(239, 246, 255, .78);
        }

        .count-control span {
          color: #1e3a8a;
          font-size: 14px;
          font-weight: 800;
        }

        .count-control button {
          border: 1px solid rgba(96, 165, 250, .72);
          border-radius: 12px;
          background: rgba(255, 255, 255, .86);
          color: #1d4ed8;
          font-size: 18px;
          font-weight: 900;
          cursor: pointer;
          padding: 6px 8px;
        }

        .count-control strong {
          text-align: center;
          color: #172554;
          font-size: 20px;
        }

        .count-control .apply-count {
          font-size: 13px;
          padding: 8px 10px;
          background: linear-gradient(135deg, #93c5fd, #bfdbfe);
        }

        .modal-line {
          width: 100%;
          border: 0;
          border-top: 1px solid rgba(147, 197, 253, .72);
        }

        .card-search-backdrop {
          position: fixed;
          inset: 0;
          z-index: 120;
          display: grid;
          place-items: center;
          padding: 20px;
          background: rgba(15, 23, 42, .26);
        }

        .card-search-popup {
          width: min(560px, 100%);
          max-height: 80vh;
          overflow: hidden;
          padding: 18px;
          gap: 12px;
        }

        .card-search-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: start;
        }

        .card-search-head h2 {
          margin: 0;
          font-size: 24px;
        }

        .search-close-button {
          border: 1px solid rgba(147, 197, 253, .72);
          border-radius: 999px;
          padding: 7px 11px;
          background: rgba(255, 255, 255, .9);
          color: #1d4ed8;
          font-size: 13px;
          font-weight: 900;
          cursor: pointer;
        }

        .search-result-list {
          display: grid;
          gap: 8px;
          max-height: 48vh;
          overflow-y: auto;
          overflow-x: hidden;
          padding-right: 4px;
          overscroll-behavior: contain;
        }

        .search-result-button {
          display: grid;
          grid-template-columns: 48px 1fr;
          gap: 10px;
          align-items: center;
          width: 100%;
          text-align: left;
          padding: 8px;
          border: 1px solid rgba(147, 197, 253, .72);
          border-radius: 12px;
          background: rgba(255, 255, 255, .9);
          color: #172554;
          cursor: pointer;
        }

        .search-result-thumb {
          width: 48px;
          aspect-ratio: 3 / 4;
          border-radius: 8px;
          border: 1px dashed rgba(96, 165, 250, .58);
          background: rgba(239, 246, 255, .9);
          overflow: hidden;
          display: grid;
          place-items: center;
          font-size: 16px;
        }

        .search-result-thumb img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .search-result-button strong {
          display: block;
          font-size: 13px;
          line-height: 1.35;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .modal-small {
          font-size: 13px;
        }

        @media (max-width: 1100px) {
          .deck-editor-layout {
            grid-template-columns: 1fr;
          }

          .deck-side-panel {
            position: static;
          }

          .deck-grid {
            height: min(74vh, 780px);
          }
        }
      `}</style>
    </main>
  );
}
