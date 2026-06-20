"use client";

import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import styles from "./LoginButtons.module.css";

async function signIn() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: `${window.location.origin}/home` }
  });

  if (error) alert(error.message);
}

export function LoginButtons() {
  return (
    <div className={styles.wrap}>
      <Button variant="primary" onClick={signIn}>
        Discordでログイン
      </Button>
    </div>
  );
}
