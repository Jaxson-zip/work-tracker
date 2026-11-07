import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSession, onAuthChange, supabase } from "./supabase";
import AuthPage from "./team/AuthPage";
import { demoEnabled, demoPeople, setDemoUser } from "./team/client";
import TeamWorkbench from "./team/TeamWorkbench";

const demoSession = (id: string) => ({ user: { id, email: "" } }) as Session;

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [recovering, setRecovering] = useState(() => window.location.hash.includes("type=recovery"));

  useEffect(() => {
    if (demoEnabled) {
      setDemoUser(demoPeople[0].id);
      setSession(demoSession(demoPeople[0].id));
      setReady(true);
      return;
    }
    let active = true;
    let changed = false;
    const apply = (next: Session | null) => {
      if (!active) return;
      setSession(next);
      setReady(true);
    };
    const unsubscribe = onAuthChange((next) => {
      changed = true;
      apply(next);
    });
    const recovery = supabase?.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
    });
    getSession()
      .then((next) => {
        if (!changed) apply(next);
      })
      .catch(() => apply(null));
    return () => {
      active = false;
      unsubscribe();
      recovery?.data.subscription.unsubscribe();
    };
  }, []);

  function switchDemoUser(id: string) {
    setDemoUser(id);
    setSession(demoSession(id));
  }

  if (!ready)
    return (
      <div className="splash" role="status">
        正在打开…
      </div>
    );
  if (!session) return <AuthPage />;
  if (recovering) return <AuthPage recovery onDone={() => setRecovering(false)} />;
  return <TeamWorkbench key={session.user.id} session={session} onSwitchDemoUser={switchDemoUser} />;
}
