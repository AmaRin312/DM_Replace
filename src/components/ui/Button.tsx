import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
};

export function Button({ children, variant = "secondary", className = "", ...props }: ButtonProps) {
  return (
    <button className={`${styles.button} ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
