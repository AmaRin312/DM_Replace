"use client";

import { LoginButtons } from "@/components/auth/LoginButtons";

export default function LoginPage() {
  const showMeaning = () => {
    if (confirm("意味を見たい？")) {
      alert(
        "『苦難を越えて星へ。』\n\nPer aspera ad astra.\n\n困難を乗り越えた先に成功や栄光がある、というラテン語の格言です。"
      );
    }
  };

  return (
    <main className="replace-page">
      <section
        className="replace-shell"
        style={{
          minHeight: "calc(100vh - 56px)",
          placeItems: "center"
        }}
      >
        <section
          className="replace-hero"
          style={{
            width: "min(640px, 100%)",
            padding: 36,
            textAlign: "center",
            display: "grid",
            gap: 14,
            justifyItems: "center"
          }}
        >
          <p className="replace-kicker">WELCOME</p>

          <h1>Due Mano</h1>

          <button
            type="button"
            onClick={showMeaning}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "#64748b",
              fontStyle: "italic",
              fontSize: "18px"
            }}
          >
            Per aspera ad astra.
          </button>

          <p
            style={{
              margin: 0,
              color: "#94a3b8",
              letterSpacing: ".08em",
              fontSize: "14px"
            }}
          >
            Two Hands, One Duel.
          </p>

          <p className="replace-sub" style={{ margin: 0 }}>
            ログインして対戦を始めましょう。
          </p>

          <div
            style={{
              width: "min(360px, 100%)",
              marginTop: 8
            }}
          >
            <LoginButtons />
          </div>
        </section>
      </section>
    </main>
  );
}