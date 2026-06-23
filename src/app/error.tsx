"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

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
          width: "min(680px, 100%)",
          border: "1px solid rgba(147, 197, 253, 0.72)",
          borderRadius: 24,
          padding: 28,
          background: "rgba(255, 255, 255, 0.95)",
          boxShadow: "0 16px 40px rgba(59, 130, 246, 0.12)",
          display: "grid",
          gap: 14
        }}
      >
        <p style={{ margin: 0, color: "#be123c", fontWeight: 800 }}>
          エラーが発生しました
        </p>
        <h1 style={{ margin: 0, color: "#2563eb" }}>
          画面を表示できませんでした
        </h1>
        <p style={{ margin: 0, color: "#64748b" }}>
          通信状態やログイン状態が不安定な可能性があります。まずは再読み込みを試してください。
        </p>
        {error.digest && (
          <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
            エラーID：{error.digest}
          </p>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={reset}
            style={{
              border: "1px solid rgba(96, 165, 250, 0.72)",
              borderRadius: 16,
              padding: "12px 18px",
              background: "#dbeafe",
              color: "#1e3a8a",
              fontWeight: 800,
              cursor: "pointer"
            }}
          >
            再読み込み
          </button>
          <Link
            href="/home"
            style={{
              border: "1px solid rgba(96, 165, 250, 0.72)",
              borderRadius: 16,
              padding: "12px 18px",
              background: "#fff",
              color: "#1d4ed8",
              fontWeight: 800,
              textDecoration: "none"
            }}
          >
            ホームへ戻る
          </Link>
        </div>
      </section>
    </main>
  );
}
