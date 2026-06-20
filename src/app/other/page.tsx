import Link from "next/link";

function MenuCard({
  href,
  icon,
  title,
  description,
  label = "準備中"
}: {
  href?: string;
  icon: string;
  title: string;
  description: string;
  label?: string;
}) {
  const content = (
    <>
      <span className="replace-icon">{icon}</span>
      <strong>{title}</strong>
      <span>{description}</span>
      {!href && <span className="replace-mini">{label}</span>}
    </>
  );

  if (!href) {
    return <article className="replace-card" style={{ opacity: 0.82 }}>{content}</article>;
  }

  return <Link href={href} className="replace-card">{content}</Link>;
}

export default function OtherPage() {
  return (
    <main className="replace-page">
      <section className="replace-shell">
        <header className="replace-header">
          <div>
            <p className="replace-kicker">OTHER</p>
            <h1>その他</h1>
            <p className="replace-sub">
              通常ユーザー向けの説明、設定、サプライ、利用案内をまとめます。
            </p>
          </div>

          <Link href="/home" className="soft-link">
            ホームへ
          </Link>
        </header>

        <section className="replace-grid">
          <MenuCard
            icon="📘"
            title="操作説明"
            description="WASDメニュー、山札操作、シールドブレイク、複数選択などの操作説明を掲載予定です。"
          />

          <MenuCard
            icon="🎨"
            title="サプライ管理"
            description="背景、カード裏面、中央キャラクター、カウンターなどを管理する機能です。"
          />

          <MenuCard
            icon="📣"
            title="お知らせ"
            description="運営からのお知らせや重要な更新内容を確認できます。"
          />

          <MenuCard
            icon="📝"
            title="更新履歴"
            description="機能追加、修正、試運転中の変更点を確認できます。"
          />

          <MenuCard
            icon="⚠️"
            title="利用規約・注意事項"
            description="利用上の注意、カード画像の取り扱い、禁止事項などを掲載予定です。"
          />

          <MenuCard
            href="/profile"
            icon="🐾"
            title="プロフィール編集"
            description="名前、アイコン、一言挨拶を編集します。"
          />
        </section>
      </section>
    </main>
  );
}
