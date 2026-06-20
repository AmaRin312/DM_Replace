"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { getOrCreateProfile } from "@/lib/auth/getOrCreateProfile";

type Role = "owner" | "admin" | "editor" | "support" | "user";

type ProfileRow = {
  id: string;
  auth_user_id: string | null;
  provider?: string | null;
  nickname: string | null;
  role: Role | string | null;
  last_login_at?: string | null;
  created_at?: string | null;
};

const ROLE_OPTIONS: Array<{ value: Role; label: string; description: string }> = [
  { value: "owner", label: "owner", description: "全権限。自分自身の降格は不可。" },
  { value: "admin", label: "admin", description: "管理者向け機能を広く使用できます。" },
  { value: "editor", label: "editor", description: "カード画像・カード情報などの編集を担当します。" },
  { value: "support", label: "support", description: "不具合報告やルーム確認などの補助担当です。" },
  { value: "user", label: "権限なし", description: "通常ユーザーです。" }
];

const ROLE_GROUPS: Role[] = ["owner", "admin", "editor", "support", "user"];

function normalizeRole(role: string | null | undefined): Role {
  if (role === "owner" || role === "admin" || role === "editor" || role === "support" || role === "user") {
    return role;
  }
  return "user";
}

function getRoleLabel(role: string | null | undefined) {
  return ROLE_OPTIONS.find((option) => option.value === normalizeRole(role))?.label ?? "権限なし";
}

function getDisplayName(profile: ProfileRow) {
  return profile.nickname?.trim() || "名無し";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "未記録";
  return new Date(value).toLocaleString("ja-JP");
}

export default function AdminPermissionsPage() {
  const [myProfile, setMyProfile] = useState<ProfileRow | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [query, setQuery] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [selectedRole, setSelectedRole] = useState<Role>("editor");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const canManage = normalizeRole(myProfile?.role) === "owner";

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId]
  );

  const filteredProfiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return profiles;

    return profiles.filter((profile) => {
      const nickname = profile.nickname?.toLowerCase() ?? "";
      const provider = profile.provider?.toLowerCase() ?? "";
      const role = normalizeRole(profile.role);
      return nickname.includes(normalizedQuery) || provider.includes(normalizedQuery) || role.includes(normalizedQuery);
    });
  }, [profiles, query]);

  const groupedProfiles = useMemo(() => {
    const map = new Map<Role, ProfileRow[]>();
    ROLE_GROUPS.forEach((role) => map.set(role, []));

    profiles.forEach((profile) => {
      map.get(normalizeRole(profile.role))?.push(profile);
    });

    ROLE_GROUPS.forEach((role) => {
      map.set(
        role,
        [...(map.get(role) ?? [])].sort((a, b) =>
          getDisplayName(a).localeCompare(getDisplayName(b), "ja")
        )
      );
    });

    return map;
  }, [profiles]);

  async function loadProfiles() {
    setLoading(true);
    setMessage("");

    const profile = await getOrCreateProfile();

    if (!profile) {
      setMessage("ログイン情報を確認できませんでした。");
      setLoading(false);
      return;
    }

    setMyProfile(profile as unknown as ProfileRow);

    const { data, error } = await supabase
      .from("profiles")
      .select("id, auth_user_id, provider, nickname, role, last_login_at, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      setMessage(`プロフィール一覧の読み込みに失敗しました：${error.message}`);
      setLoading(false);
      return;
    }

    setProfiles((data ?? []) as ProfileRow[]);
    setLoading(false);
  }

  function selectProfile(profile: ProfileRow) {
    setSelectedProfileId(profile.id);
    setSelectedRole(normalizeRole(profile.role) === "owner" ? "admin" : normalizeRole(profile.role));
    setMessage(`「${getDisplayName(profile)}」を選択しました。`);
  }

  async function changeRole(targetProfileId: string, nextRole: Role) {
    if (saving) return;

    const target = profiles.find((profile) => profile.id === targetProfileId);

    if (!target) {
      setMessage("対象ユーザーが見つかりません。");
      return;
    }

    if (target.id === myProfile?.id && nextRole !== "owner") {
      setMessage("ownerは自分自身を降格できません。");
      return;
    }

    const ok = window.confirm(
      `「${getDisplayName(target)}」の権限を「${getRoleLabel(nextRole)}」に変更しますか？`
    );

    if (!ok) return;

    setSaving(true);
    setMessage("");

    try {
      const { error } = await supabase.rpc("set_profile_role", {
        target_profile_id: targetProfileId,
        next_role: nextRole
      });

      if (error) {
        console.error(error);
        setMessage(`権限変更に失敗しました：${error.message}`);
        return;
      }

      setMessage(`「${getDisplayName(target)}」の権限を「${getRoleLabel(nextRole)}」に変更しました。`);
      await loadProfiles();
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void loadProfiles();
  }, []);

  if (loading) {
    return (
      <main className="page">
        <h1>権限管理</h1>
        <p className="muted">読み込み中...</p>
      </main>
    );
  }

  if (!canManage) {
    return (
      <main className="page">
        <h1>権限管理</h1>
        <p className="muted">このページを利用できるのは owner のみです。</p>
        {message && <p className="muted">{message}</p>}
        <a href="/admin">管理者ページへ戻る</a>
      </main>
    );
  }

  return (
    <main className="page">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>権限管理</h1>
          <p className="muted" style={{ marginTop: 0 }}>
            ログイン済みユーザーを選択し、admin / editor / support などの権限を付与・変更・削除します。
          </p>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a href="/home">🏠 ホーム</a>
          <a href="/admin">🔐 管理者</a>
        </div>
      </div>

      {message && <p className="muted">{message}</p>}

      <section style={{ display: "grid", gridTemplateColumns: "minmax(320px, 460px) 1fr", gap: 16, alignItems: "start" }}>
        <div style={{ border: "1px solid #444", borderRadius: 12, padding: 12, background: "#1f1f1f", display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0 }}>ログイン済みユーザー</h2>

          <label>
            検索
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前 / provider / role" />
          </label>

          <div style={{ display: "grid", gap: 8, maxHeight: 460, overflow: "auto" }}>
            {filteredProfiles.map((profile) => {
              const isSelected = selectedProfileId === profile.id;
              const isSelf = profile.id === myProfile?.id;

              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => selectProfile(profile)}
                  style={{
                    border: isSelected ? "1px solid #4ea3ff" : "1px solid #444",
                    borderRadius: 10,
                    padding: 10,
                    background: isSelected ? "#0f172a" : "#111",
                    color: "#fff",
                    cursor: "pointer",
                    textAlign: "left",
                    display: "grid",
                    gap: 4
                  }}
                >
                  <strong>{getDisplayName(profile)}{isSelf ? "（自分）" : ""}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>
                    role：{getRoleLabel(profile.role)} / provider：{profile.provider ?? "不明"}
                  </span>
                  <span className="muted" style={{ fontSize: 11 }}>
                    最終ログイン：{formatDate(profile.last_login_at)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ border: "1px solid #444", borderRadius: 12, padding: 12, background: "#1f1f1f", display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0 }}>権限変更</h2>

          {selectedProfile ? (
            <>
              <section style={{ border: "1px solid #444", borderRadius: 10, padding: 10, background: "#111" }}>
                <strong>{getDisplayName(selectedProfile)}</strong>
                <p className="muted" style={{ marginBottom: 4 }}>
                  現在の権限：{getRoleLabel(selectedProfile.role)}
                </p>
                <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                  登録日：{formatDate(selectedProfile.created_at)}
                </p>
              </section>

              <label>
                変更後の権限
                <select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as Role)}>
                  {ROLE_OPTIONS.filter((option) => option.value !== "owner").map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <button type="button" onClick={() => changeRole(selectedProfile.id, selectedRole)} disabled={saving}>
                {saving ? "変更中..." : "権限を変更"}
              </button>

              <button type="button" onClick={() => changeRole(selectedProfile.id, "user")} disabled={saving || selectedProfile.id === myProfile?.id}>
                権限を削除
              </button>
            </>
          ) : (
            <p className="muted">左の一覧からユーザーを選択してください。</p>
          )}
        </div>
      </section>

      <section style={{ marginTop: 16, border: "1px solid #444", borderRadius: 12, padding: 12, background: "#1f1f1f" }}>
        <h2 style={{ marginTop: 0 }}>権限ごとの一覧</h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {ROLE_GROUPS.map((role) => {
            const roleProfiles = groupedProfiles.get(role) ?? [];

            return (
              <section key={role} style={{ border: "1px solid #444", borderRadius: 10, padding: 10, background: "#111", display: "grid", gap: 8 }}>
                <h3 style={{ margin: 0 }}>{getRoleLabel(role)}：{roleProfiles.length}人</h3>

                {roleProfiles.length === 0 ? (
                  <p className="muted">該当者なし</p>
                ) : (
                  roleProfiles.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => selectProfile(profile)}
                      style={{
                        border: selectedProfileId === profile.id ? "1px solid #4ea3ff" : "1px solid #333",
                        borderRadius: 8,
                        padding: 8,
                        background: selectedProfileId === profile.id ? "#0f172a" : "#050505",
                        color: "#fff",
                        cursor: "pointer",
                        textAlign: "left"
                      }}
                    >
                      <strong>{getDisplayName(profile)}</strong>
                      {profile.id === myProfile?.id && <span className="muted">（自分）</span>}
                    </button>
                  ))
                )}
              </section>
            );
          })}
        </div>
      </section>
    </main>
  );
}
