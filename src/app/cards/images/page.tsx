"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClipboardEvent, DragEvent } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { getOrCreateProfile } from "@/lib/auth/getOrCreateProfile";

type CardRow = {
  id: string;
  name: string;
  image_url: string | null;
  thumbnail_url: string | null;
  civilization: string | null;
  cost: number | null;
  is_official: boolean | null;
};

type ProfileLike = {
  id: string;
  nickname: string | null;
  role?: string | null;
};

const STORAGE_BUCKET = "card-images";
const THUMBNAIL_WIDTH = 360;
const THUMBNAIL_QUALITY = 0.72;

function canManageCardImages(profile: ProfileLike | null) {
  return (
    profile?.role === "owner" ||
    profile?.role === "admin" ||
    profile?.role === "editor"
  );
}

function getFileExtension(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase();

  if (fromName) return fromName;

  switch (file.type) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "jpg";
  }
}

function normalizeCardName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeNullableText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNullableCost(value: string) {
  const trimmed = value.trim();

  if (!trimmed) return null;

  const parsed = Number(trimmed);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

async function createThumbnailFile(file: File): Promise<File> {
  const imageBitmap = await createImageBitmap(file);

  const scale = THUMBNAIL_WIDTH / imageBitmap.width;
  const thumbnailWidth = THUMBNAIL_WIDTH;
  const thumbnailHeight = Math.max(1, Math.round(imageBitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = thumbnailWidth;
  canvas.height = thumbnailHeight;

  const context = canvas.getContext("2d");

  if (!context) {
    imageBitmap.close();
    throw new Error("サムネイル生成に失敗しました。");
  }

  context.drawImage(imageBitmap, 0, 0, thumbnailWidth, thumbnailHeight);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/webp", THUMBNAIL_QUALITY);
  });

  imageBitmap.close();

  if (!blob) {
    throw new Error("サムネイル画像の変換に失敗しました。");
  }

  return new File([blob], "thumbnail.webp", {
    type: "image/webp"
  });
}

export default function CardImagesPage() {
  const [profile, setProfile] = useState<ProfileLike | null>(null);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [query, setQuery] = useState("");
  const [cardName, setCardName] = useState("");
  const [civilization, setCivilization] = useState("");
  const [cost, setCost] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const editingCard = useMemo(
    () => cards.find((card) => card.id === editingCardId) ?? null,
    [cards, editingCardId]
  );

  const filteredCards = useMemo(() => {
    const trimmed = query.trim().toLowerCase();

    if (!trimmed) return cards;

    return cards.filter((card) => card.name.toLowerCase().includes(trimmed));
  }, [cards, query]);

  function clearForm() {
    setCardName("");
    setCivilization("");
    setCost("");
    setSelectedFile(null);
    setEditingCardId(null);

    if (previewUrl && previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }

    setPreviewUrl("");
  }

  function startEditCard(card: CardRow) {
    if (previewUrl && previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }

    setEditingCardId(card.id);
    setCardName(card.name);
    setCivilization(card.civilization ?? "");
    setCost(card.cost === null || card.cost === undefined ? "" : String(card.cost));
    setSelectedFile(null);
    setPreviewUrl(card.thumbnail_url ?? card.image_url ?? "");
    setMessage(`「${card.name}」を編集中です。画像を選び直すと差し替えできます。`);
  }

  function setImageFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setMessage("画像ファイルを選択してください。");
      return;
    }

    if (previewUrl && previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setMessage("画像を読み込みました。保存時に軽量サムネイルも自動生成します。");
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();

    const file = event.dataTransfer.files.item(0);

    if (!file) {
      setMessage("画像ファイルを取得できませんでした。");
      return;
    }

    setImageFile(file);
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const items = Array.from(event.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith("image/"));

    if (!imageItem) return;

    const file = imageItem.getAsFile();

    if (!file) {
      setMessage("貼り付け画像を取得できませんでした。");
      return;
    }

    setImageFile(file);
  }

  async function loadCards() {
    setLoading(true);
    setMessage("");

    const nextProfile = await getOrCreateProfile();

    if (!nextProfile) {
      setProfile(null);
      setMessage("ログイン情報を確認できませんでした。");
      setLoading(false);
      return;
    }

    setProfile(nextProfile as ProfileLike);

    if (!canManageCardImages(nextProfile as ProfileLike)) {
      setMessage("カードを追加できるのは owner / admin / editor のみです。");
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("cards")
      .select("id, name, image_url, thumbnail_url, civilization, cost, is_official")
      .order("name", { ascending: true })
      .limit(1000);

    if (error) {
      console.error(error);
      setMessage("カード一覧の読み込みに失敗しました。cards テーブルに thumbnail_url 列があるか確認してください。");
      setLoading(false);
      return;
    }

    setCards((data ?? []) as CardRow[]);
    setLoading(false);
  }

  async function uploadImagesIfNeeded() {
    if (!selectedFile) {
      return {
        imageUrl: editingCard?.image_url ?? null,
        thumbnailUrl: editingCard?.thumbnail_url ?? null
      };
    }

    const fileId = crypto.randomUUID();
    const originalExtension = getFileExtension(selectedFile);
    const originalPath = `cards/original/${fileId}.${originalExtension}`;
    const thumbnailPath = `cards/thumbnails/${fileId}.webp`;

    const thumbnailFile = await createThumbnailFile(selectedFile);

    const { error: originalUploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(originalPath, selectedFile, {
        cacheControl: "31536000",
        upsert: false,
        contentType: selectedFile.type
      });

    if (originalUploadError) {
      throw new Error(`高画質画像のアップロードに失敗しました：${originalUploadError.message}`);
    }

    const { error: thumbnailUploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(thumbnailPath, thumbnailFile, {
        cacheControl: "31536000",
        upsert: false,
        contentType: "image/webp"
      });

    if (thumbnailUploadError) {
      throw new Error(`サムネイル画像のアップロードに失敗しました：${thumbnailUploadError.message}`);
    }

    const { data: originalUrlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(originalPath);

    const { data: thumbnailUrlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(thumbnailPath);

    return {
      imageUrl: originalUrlData.publicUrl,
      thumbnailUrl: thumbnailUrlData.publicUrl
    };
  }

  async function saveCard() {
    if (saving) return;

    const normalizedName = normalizeCardName(cardName);
    const normalizedCivilization = normalizeNullableText(civilization);
    const normalizedCost = normalizeNullableCost(cost);

    if (!normalizedName) {
      setMessage("カード名を入力してください。");
      return;
    }

    if (cost.trim() && normalizedCost === null) {
      setMessage("コストは0以上の整数で入力してください。");
      return;
    }

    if (!editingCard && !selectedFile) {
      setMessage("追加するカードイラストをドラッグ&ドロップ、ペースト、またはファイル選択してください。");
      return;
    }

    const duplicate = cards.find(
      (card) =>
        card.id !== editingCardId &&
        normalizeCardName(card.name) === normalizedName
    );

    if (duplicate) {
      setMessage("同じ名前のカードが既に存在します。");
      return;
    }

    setSaving(true);
    setMessage(editingCard ? "カード情報を更新しています。" : "画像とサムネイルを保存しています。");

    try {
      const { imageUrl, thumbnailUrl } = await uploadImagesIfNeeded();

      if (editingCard) {
        const { data, error } = await supabase
          .from("cards")
          .update({
            name: normalizedName,
            civilization: normalizedCivilization,
            cost: normalizedCost,
            image_url: imageUrl,
            thumbnail_url: thumbnailUrl,
            is_proxy: false,
            is_official: true
          })
          .eq("id", editingCard.id)
          .select("id, name, image_url, thumbnail_url, civilization, cost, is_official")
          .single();

        if (error) {
          console.error(error);
          setMessage(`カード更新に失敗しました：${error.message}`);
          return;
        }

        setCards((current) =>
          current
            .map((card) => (card.id === editingCard.id ? (data as CardRow) : card))
            .sort((a, b) => a.name.localeCompare(b.name, "ja"))
        );

        setMessage(`「${normalizedName}」を更新しました。`);
        clearForm();
        return;
      }

      const { data, error } = await supabase
        .from("cards")
        .insert({
          name: normalizedName,
          civilization: normalizedCivilization,
          cost: normalizedCost,
          image_url: imageUrl,
          thumbnail_url: thumbnailUrl,
          is_proxy: false,
          is_official: true
        })
        .select("id, name, image_url, thumbnail_url, civilization, cost, is_official")
        .single();

      if (error) {
        console.error(error);
        setMessage(`cards テーブルへのカード追加に失敗しました：${error.message}`);
        return;
      }

      setCards((current) =>
        [...current, data as CardRow].sort((a, b) =>
          a.name.localeCompare(b.name, "ja")
        )
      );

      setMessage(`「${normalizedName}」を追加しました。`);
      clearForm();
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error
          ? error.message
          : "カード保存中に予期しないエラーが発生しました。"
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteCard(card: CardRow) {
    const ok = window.confirm(
      `「${card.name}」を削除しますか？\n\n既存デッキ内のカード名は残りますが、登録画像・文明・コストの参照はできなくなります。`
    );

    if (!ok) return;

    setSaving(true);
    setMessage("");

    try {
      const { error } = await supabase
        .from("cards")
        .delete()
        .eq("id", card.id);

      if (error) {
        console.error(error);
        setMessage(`カード削除に失敗しました：${error.message}`);
        return;
      }

      setCards((current) => current.filter((currentCard) => currentCard.id !== card.id));

      if (editingCardId === card.id) {
        clearForm();
      }

      setMessage(`「${card.name}」を削除しました。`);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void loadCards();

    return () => {
      if (previewUrl && previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, []);

  if (loading) {
    return (
      <main className="replace-page">
        <section className="replace-shell">
          <section className="replace-panel">
            <h1>カードイラスト登録</h1>
            <p className="replace-sub">読み込み中...</p>
          </section>
        </section>
      </main>
    );
  }

  if (!canManageCardImages(profile)) {
    return (
      <main className="replace-page">
        <section className="replace-shell">
          <section className="replace-panel">
            <h1>カードイラスト登録</h1>
            <p className="replace-sub">
              {message || "このページを利用する権限がありません。"}
            </p>
            <Link href="/decks" className="soft-link" style={{ width: "fit-content" }}>
              デッキ管理へ戻る
            </Link>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="replace-page" onPaste={handlePaste}>
      <section className="replace-shell">
        <header className="replace-header">
          <div>
            <p className="replace-kicker">CARD IMAGE</p>
            <h1>カードイラスト登録</h1>
            <p className="replace-sub">
              カードの追加・編集・削除ができます。画像1枚から高画質版と軽量サムネイル版を自動保存します。
            </p>
          </div>

          <div className="replace-actions">
            <Link href="/home" className="soft-link">ホームへ</Link>
            <Link href="/decks" className="soft-link">デッキ管理</Link>
          </div>
        </header>

        {message && <section className="replace-message">{message}</section>}

        <section className="replace-two-column">
          <section className="replace-panel">
            <div>
              <p className="replace-kicker">{editingCard ? "EDIT" : "ADD"}</p>
              <h2>{editingCard ? "カード編集" : "カード追加"}</h2>
            </div>

            <label className="replace-label">
              カード名
              <input
                value={cardName}
                onChange={(event) => setCardName(event.target.value)}
                placeholder="例：ボルメテウス・ホワイト・ドラゴン"
              />
            </label>

            <label className="replace-label">
              文明
              <input
                value={civilization}
                onChange={(event) => setCivilization(event.target.value)}
                placeholder="例：火 / 水 / 自然 / 光 / 闇 / 多色"
              />
            </label>

            <label className="replace-label">
              コスト
              <input
                value={cost}
                onChange={(event) => setCost(event.target.value)}
                placeholder="例：7"
                inputMode="numeric"
              />
            </label>

            <div
              onDrop={handleDrop}
              onDragOver={(event) => event.preventDefault()}
              style={{
                minHeight: 300,
                border: "2px dashed rgba(96,165,250,.72)",
                borderRadius: 22,
                background: "rgba(255,255,255,.72)",
                display: "grid",
                placeItems: "center",
                textAlign: "center",
                padding: 16,
                overflow: "hidden"
              }}
            >
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="プレビュー"
                  style={{
                    width: "100%",
                    maxHeight: 420,
                    objectFit: "contain",
                    borderRadius: 16
                  }}
                />
              ) : (
                <div>
                  <div className="replace-icon" style={{ margin: "0 auto 12px" }}>☁️</div>
                  <strong style={{ color: "#1d4ed8" }}>ここに画像をドロップ</strong>
                  <p className="replace-sub">または、このページ上で Ctrl + V で画像を貼り付け</p>
                </div>
              )}
            </div>

            <label className="replace-label">
              ファイルから選択
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) setImageFile(file);
                }}
              />
            </label>

            <div className="replace-actions">
              <button type="button" onClick={saveCard} disabled={saving} className="replace-button primary">
                {saving
                  ? "保存中..."
                  : editingCard
                    ? "カードを更新"
                    : "カードを追加"}
              </button>

              {editingCard && (
                <button type="button" onClick={clearForm} disabled={saving} className="replace-button secondary">
                  編集をやめる
                </button>
              )}
            </div>
          </section>

          <section className="replace-panel">
            <div>
              <p className="replace-kicker">CARD LIST</p>
              <h2>登録済みカード</h2>
            </div>

            <label className="replace-label">
              検索
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="カード名で検索"
              />
            </label>

            <div
              className="replace-scroll"
              style={{
                marginTop: 4,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: 10,
                maxHeight: "70vh",
                overflow: "auto",
                paddingRight: 4
              }}
            >
              {filteredCards.map((card) => (
                <article
                  key={card.id}
                  style={{
                    border: editingCardId === card.id
                      ? "1px solid #60a5fa"
                      : "1px solid rgba(147,197,253,.66)",
                    borderRadius: 16,
                    padding: 9,
                    background: editingCardId === card.id
                      ? "rgba(219,234,254,.92)"
                      : "rgba(255,255,255,.78)",
                    display: "grid",
                    gap: 7,
                    boxShadow: "0 10px 22px rgba(59,130,246,.08)"
                  }}
                >
                  <div
                    style={{
                      aspectRatio: "63 / 88",
                      border: "1px dashed rgba(96,165,250,.58)",
                      borderRadius: 12,
                      display: "grid",
                      placeItems: "center",
                      overflow: "hidden",
                      background: "rgba(239,246,255,.72)"
                    }}
                  >
                    {card.thumbnail_url || card.image_url ? (
                      <img
                        src={card.thumbnail_url ?? card.image_url ?? ""}
                        alt={card.name}
                        loading="lazy"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "contain"
                        }}
                      />
                    ) : (
                      <span className="replace-mini">画像なし</span>
                    )}
                  </div>

                  <strong
                    title={card.name}
                    style={{
                      fontSize: 12,
                      lineHeight: 1.35,
                      color: "#172554",
                      overflow: "hidden",
                      textOverflow: "ellipsis"
                    }}
                  >
                    {card.name}
                  </strong>

                  <span className="replace-mini">
                    {card.civilization ?? "文明未登録"} / コスト：
                    {card.cost ?? "未登録"}
                  </span>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => startEditCard(card)}
                      disabled={saving}
                      className="replace-button secondary"
                      style={{ fontSize: 12, padding: "6px 4px" }}
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteCard(card)}
                      disabled={saving}
                      className="replace-button danger"
                      style={{ fontSize: 12, padding: "6px 4px" }}
                    >
                      削除
                    </button>
                  </div>
                </article>
              ))}

              {filteredCards.length === 0 && (
                <p className="replace-sub">登録済みカードはありません。</p>
              )}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
