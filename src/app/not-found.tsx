import Link from "next/link";

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#f8fbff",
        color: "#172554"
      }}
    >
      <section
        style={{
          width: "min(640px, 100%)",
          border: "1px solid rgba(147, 197, 253, 0.72)",
          borderRadius: 24,
          padding: 28,
          background: "rgba(255, 255, 255, 0.95)",
          boxShadow: "0 16px 40px rgba(59, 130, 246, 0.12)",
          display: "grid",
          gap: 14
        }}
      >
        <p style={{ margin: 0, color: "#64748b", fontWeight: 800 }}>
          404 Not Found
        </p>
        <h1 style={{ margin: 0, color: "#2563eb" }}>
          ページが見つかりません
        </h1>
        <p style={{ margin: 0, color: "#64748b" }}>
          URLが間違っているか、部屋が解散済みの可能性があります。
        </p>
        <Link
          href="/home"
          style={{
            width: "fit-content",
            border: "1px solid rgba(96, 165, 250, 0.72)",
            borderRadius: 16,
            padding: "12px 18px",
            background: "#dbeafe",
            color: "#1e3a8a",
            fontWeight: 800,
            textDecoration: "none"
          }}
        >
          ホームへ戻る
        </Link>
      </section>
    </main>
  );
}
