"use client";

import Link from "next/link";

function showProverbMeaning(meaning: string) {
  if (window.confirm("意味を見たい？")) {
    window.alert(meaning);
  }
}

function MenuCard({
  href,
  icon,
  title,
  description,
  disabledLabel
}: {
  href?: string;
  icon: string;
  title: string;
  description: string;
  disabledLabel?: string;
}) {
  const content = (
    <>
      <span className="replace-icon">{icon}</span>
      <strong>{title}</strong>
      <span>{description}</span>
      {disabledLabel && <span className="replace-mini">{disabledLabel}</span>}
    </>
  );

  if (!href) {
    return <article className="replace-card" style={{ opacity: 0.78 }}>{content}</article>;
  }

  return <Link href={href} className="replace-card">{content}</Link>;
}

export default function DecksPage() {
  return (
    <main className="replace-page">
      <section className="replace-shell">
        <header className="replace-header">
          <div>
            <p className="replace-kicker">DECK</p>
            <h1>デッキ管理</h1>
            <button
              type="button"
              className="due-proverb-button"
              onClick={() => showProverbMeaning("これでサラダができた。転じて『やっちまった』『面倒なことになった』という意味です。")}
            >
              Jetzt haben wir den Salat.
            </button>
            <p className="replace-sub">
              デッキの新規作成、保存済みデッキの編集、デッキコードからの作成を行います。
            </p>
          </div>

          <Link href="/home" className="soft-link">
            ホームへ
          </Link>
        </header>

        <section className="replace-grid">
          <MenuCard
            href="/decks/new"
            icon="＋"
            title="新規デッキ作成"
            description="40枚デッキを新しく作成します。"
          />

          <MenuCard
            href="/decks/saved"
            icon="🃏"
            title="保存済みデッキ"
            description="保存済みデッキの確認、編集、削除、デッキコード表示。"
          />

          <MenuCard
            href="/decks/code"
            icon="🔗"
            title="デッキコードで作成"
            description="D-XXXXXX から共有デッキを読み込み、保存します。"
          />

          <MenuCard
            icon="🖼️"
            title="デッキ画像から生成"
            description="デッキ画像をもとに半自動でデッキを作成する機能です。"
            disabledLabel="後で実装"
          />
        </section>
      </section>
    </main>
  );
}
