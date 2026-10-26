import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowUpRight, LogOut, LayoutDashboard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2 ${className}`}>
      <span className="relative grid place-items-center w-9 h-9 rounded-2xl bg-primary">
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-lime shadow-glow" />
        <span className="text-primary-foreground font-display font-bold text-sm">Bx</span>
      </span>
      <span className="font-display font-bold text-xl tracking-tight">
        BlipX<span className="text-lime">.</span>
      </span>
    </Link>
  );
}

export function BlipxNav() {
  const [email, setEmail] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  return (
    <header className="w-full px-4 pt-5 sticky top-0 z-40">
      <nav className="max-w-6xl mx-auto pill bg-surface/80 backdrop-blur border border-border shadow-pill flex items-center justify-between px-3 py-2.5">
        <Logo />
        <div className="hidden md:flex items-center gap-1 text-sm font-medium">
          {[
            ["Product", "/#product"],
            ["How it works", "/#how"],
            ["Pricing", "/#pricing"],
            ["FAQ", "/#faq"],
          ].map(([label, href]) => (
            <a
              key={label}
              href={href}
              className="px-4 py-2 rounded-full text-ink-soft hover:text-foreground hover:bg-muted transition"
            >
              {label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {email ? (
            <>
              <Link
                to="/dashboard"
                className="hidden sm:inline-flex pill items-center gap-1.5 px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted transition"
              >
                <LayoutDashboard className="size-4" /> Dashboard
              </Link>
              <button
                onClick={signOut}
                className="pill inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border border-border hover:bg-muted"
                title={email}
              >
                <LogOut className="size-4" /> Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                to="/auth"
                className="hidden sm:inline-flex pill px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted transition"
              >
                Sign in
              </Link>
              <Link
                to="/agents/new"
                className="inline-flex items-center gap-1.5 pill bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition"
              >
                Build an agent <ArrowUpRight className="size-4" />
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
