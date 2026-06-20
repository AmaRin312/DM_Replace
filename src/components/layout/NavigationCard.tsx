import Link from "next/link";
import styles from "./NavigationCard.module.css";

export function NavigationCard({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link href={href} className={styles.card}>
      <strong>{title}</strong>
      <span>{description}</span>
    </Link>
  );
}
