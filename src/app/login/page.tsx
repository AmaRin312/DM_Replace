import { LoginButtons } from "@/components/auth/LoginButtons";

export default function LoginPage() {
  return (
    <main className="replace-page">
      <section className="replace-shell" style={{ minHeight: "calc(100vh - 56px)", placeItems: "center" }}>
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
          <h1>デュエルマスターズ Replace</h1>
          <p className="replace-sub" style={{ margin: 0 }}>
            ログインして対戦を始めましょう。
          </p>
          <div style={{ width: "min(360px, 100%)", marginTop: 8 }}>
            <LoginButtons />
          </div>
        </section>
      </section>
    </main>
  );
}
