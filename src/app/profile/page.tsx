"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { getOrCreateProfile } from "@/lib/auth/getOrCreateProfile";

type Profile = {
  id: string;
  nickname: string | null;
  role?: string | null;
  avatar_key?: string | null;
  avatar_url?: string | null;
  greeting?: string | null;
};

const AVATAR_BUCKET = "avatars";

const AVATAR_OPTIONS = [
  { key: "dragon", label: "ドラゴン", icon: "🐉" },
  { key: "phoenix", label: "フェニックス", icon: "🔥" },
  { key: "water", label: "水文明", icon: "💧" },
  { key: "nature", label: "自然文明", icon: "🌿" },
  { key: "light", label: "光文明", icon: "✨" },
  { key: "dark", label: "闇文明", icon: "🌑" },
  { key: "shield", label: "シールド", icon: "🛡️" },
  { key: "card", label: "カード", icon: "🃏" }
];

function getAvatarIcon(avatarKey: string | null | undefined) {
  return AVATAR_OPTIONS.find((option) => option.key === avatarKey)?.icon ?? "👤";
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

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [nickname, setNickname] = useState("");
  const [avatarKey, setAvatarKey] = useState("dragon");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState("");
  const [greeting, setGreeting] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const effectiveAvatarUrl = avatarPreviewUrl || avatarUrl;

  useEffect(() => {
    async function loadProfile() {
      const nextProfile = await getOrCreateProfile();

      if (!nextProfile) {
        setMessage("ログイン情報を確認できませんでした。");
        setLoading(false);
        return;
      }

      const loadedProfile = nextProfile as Profile;

      setProfile(loadedProfile);
      setNickname(loadedProfile.nickname ?? "");
      setAvatarKey(loadedProfile.avatar_key ?? "dragon");
      setAvatarUrl(loadedProfile.avatar_url ?? "");
      setGreeting(loadedProfile.greeting ?? "");
      setLoading(false);
    }

    void loadProfile();

    return () => {
      if (avatarPreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
    };
  }, []);

  function selectPresetAvatar(key: string) {
    setAvatarKey(key);
    setAvatarFile(null);
    setAvatarPreviewUrl("");
    setAvatarUrl("");
    setMessage("プリセットアイコンを選択しました。");
  }

  function selectAvatarFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setMessage("プロフィール画像には画像ファイルを選択してください。");
      return;
    }

    if (avatarPreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }

    setAvatarFile(file);
    setAvatarPreviewUrl(URL.createObjectURL(file));
    setAvatarKey("custom");
    setMessage("プロフィール画像を読み込みました。保存すると反映されます。");
  }

  async function uploadAvatarIfNeeded() {
    if (!profile) return avatarUrl || null;

    if (!avatarFile) {
      return avatarUrl || null;
    }

    const fileId = crypto.randomUUID();
    const extension = getFileExtension(avatarFile);
    const path = `${profile.id}/${fileId}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, avatarFile, {
        cacheControl: "31536000",
        upsert: false,
        contentType: avatarFile.type
      });

    if (uploadError) {
      throw new Error(`プロフィール画像のアップロードに失敗しました：${uploadError.message}`);
    }

    const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);

    return data.publicUrl;
  }

  async function saveProfile() {
    if (!profile || saving) return;

    const trimmedNickname = nickname.trim();
    const trimmedGreeting = greeting.trim();

    if (!trimmedNickname) {
      setMessage("名前を入力してください。");
      return;
    }

    if (trimmedGreeting.length > 80) {
      setMessage("一言挨拶は80文字以内で入力してください。");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const uploadedAvatarUrl = await uploadAvatarIfNeeded();

      const { data, error } = await supabase
        .from("profiles")
        .update({
          nickname: trimmedNickname,
          avatar_key: avatarKey,
          avatar_url: uploadedAvatarUrl,
          greeting: trimmedGreeting || null,
          updated_at: new Date().toISOString()
        })
        .eq("id", profile.id)
        .select("id, nickname, role, avatar_key, avatar_url, greeting")
        .single();

      if (error) {
        console.error(error);
        setMessage(`プロフィール保存に失敗しました：${error.message}`);
        return;
      }

      const nextProfile = data as Profile;

      setProfile(nextProfile);
      setAvatarUrl(nextProfile.avatar_url ?? "");
      setAvatarFile(null);

      if (avatarPreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }

      setAvatarPreviewUrl("");
      setMessage("プロフィールを保存しました。");
    } catch (error) {
      console.error(error);
      setMessage(
        error instanceof Error
          ? error.message
          : "プロフィール保存中に予期しないエラーが発生しました。"
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="replace-page">
        <section className="replace-shell">
          <section className="replace-panel">
            <h1>プロフィール編集</h1>
            <p className="replace-sub">読み込み中...</p>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="replace-page">
      <section className="replace-shell">
        <header className="replace-header">
          <div>
            <p className="replace-kicker">PROFILE</p>
            <h1>プロフィール編集</h1>
            <p className="replace-sub">
              対戦ルームや観戦者一覧で表示する名前、アイコン、一言挨拶を設定します。
            </p>
          </div>

          <Link href="/home" className="soft-link">
            ホームへ
          </Link>
        </header>

        {message && <section className="replace-message">{message}</section>}

        <section className="replace-two-column">
          <section className="replace-panel">
            <label className="replace-label">
              名前
              <input
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="表示名"
              />
            </label>

            <label className="replace-label">
              一言挨拶
              <input
                value={greeting}
                onChange={(event) => setGreeting(event.target.value)}
                placeholder="例：よろしくお願いします！"
                maxLength={80}
              />
            </label>

            <div>
              <strong style={{ color: "#1e3a8a" }}>画像アイコン</strong>
              <p className="replace-mini" style={{ margin: "6px 0 10px" }}>
                好きな画像を選ぶと、プリセットアイコンの代わりに表示できます。
              </p>

              <label className="replace-label">
                画像ファイル
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) selectAvatarFile(file);
                  }}
                />
              </label>

              {effectiveAvatarUrl && (
                <button
                  type="button"
                  className="replace-button secondary"
                  onClick={() => {
                    setAvatarFile(null);
                    setAvatarPreviewUrl("");
                    setAvatarUrl("");
                    setAvatarKey("dragon");
                    setMessage("画像アイコンを解除しました。保存すると反映されます。");
                  }}
                  style={{ marginTop: 10 }}
                >
                  画像アイコンを解除
                </button>
              )}
            </div>

            <div>
              <strong style={{ color: "#1e3a8a" }}>プリセットアイコン</strong>
              <div
                style={{
                  marginTop: 10,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))",
                  gap: 10
                }}
              >
                {AVATAR_OPTIONS.map((option) => {
                  const selected = !effectiveAvatarUrl && avatarKey === option.key;

                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => selectPresetAvatar(option.key)}
                      className={selected ? "replace-button primary" : "replace-button secondary"}
                      style={{
                        display: "grid",
                        gap: 8,
                        placeItems: "center",
                        padding: 12
                      }}
                    >
                      <span style={{ fontSize: 34 }}>{option.icon}</span>
                      <span style={{ fontSize: 14 }}>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <button type="button" onClick={saveProfile} disabled={saving} className="replace-button primary">
              {saving ? "保存中..." : "プロフィールを保存"}
            </button>
          </section>

          <section className="replace-panel">
            <h2>表示プレビュー</h2>

            <div
              style={{
                border: "1px solid rgba(147,197,253,.72)",
                borderRadius: 24,
                padding: 22,
                background: "rgba(255,255,255,.82)",
                display: "flex",
                gap: 18,
                alignItems: "center"
              }}
            >
              <div
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 30,
                  background: "linear-gradient(135deg,#dbeafe,#ede9fe)",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 46,
                  overflow: "hidden",
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,.72)"
                }}
              >
                {effectiveAvatarUrl ? (
                  <img
                    src={effectiveAvatarUrl}
                    alt="プロフィール画像"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover"
                    }}
                  />
                ) : (
                  getAvatarIcon(avatarKey)
                )}
              </div>

              <div>
                <strong style={{ fontSize: 26, color: "#1d4ed8" }}>
                  {nickname.trim() || "名前未設定"}
                </strong>
                <p className="replace-sub" style={{ marginBottom: 0 }}>
                  {greeting.trim() || "一言挨拶未設定"}
                </p>
              </div>
            </div>

            <section
              style={{
                border: "1px dashed rgba(96,165,250,.56)",
                borderRadius: 20,
                padding: 16,
                background: "rgba(239,246,255,.72)"
              }}
            >
              <strong style={{ color: "#1e3a8a" }}>保存前の注意</strong>
              <p className="replace-sub" style={{ marginTop: 6, fontSize: 16 }}>
                画像アイコンを使う場合は、先に Supabase Storage に avatars バケットを作成し、
                profiles テーブルに avatar_url 列を追加してください。
              </p>
            </section>
          </section>
        </section>
      </section>
    </main>
  );
}
