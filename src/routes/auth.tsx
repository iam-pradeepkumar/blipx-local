import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Logo } from "@/components/BlipxNav";
import { ArrowLeft, Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in · BlipX" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [business, setBusiness] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: name, business_name: business },
          },
        });
        if (error) throw error;
        if (data.user) {
          // populate profile business name (trigger creates row with full_name only)
          await supabase
            .from("profiles")
            .update({ business_name: business, full_name: name })
            .eq("id", data.user.id);
        }
        toast.success("Account created", { description: "You're signed in." });
        navigate({ to: "/wizard" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back");
        navigate({ to: "/dashboard" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error;
      if (!result.redirected) navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between max-w-6xl mx-auto w-full">
        <Logo />
        <Link to="/" className="text-sm text-ink-soft hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Back home
        </Link>
      </header>
      <main className="flex-1 grid place-items-center px-6 pb-12">
        <div className="w-full max-w-md surface-card p-8">
          <h1 className="font-display font-bold text-2xl">
            {mode === "signin" ? "Welcome back." : "Create your account."}
          </h1>
          <p className="text-sm text-ink-soft mt-1">
            {mode === "signin"
              ? "Sign in to manage your voice agents."
              : "Start building your first voice agent in minutes."}
          </p>

          <button
            type="button"
            onClick={google}
            disabled={busy}
            className="mt-6 w-full pill border border-border bg-surface px-4 py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-muted disabled:opacity-50"
          >
            <GoogleIcon /> Continue with Google
          </button>

          <div className="my-5 flex items-center gap-3 text-xs text-ink-soft">
            <span className="h-px bg-border flex-1" /> or email <span className="h-px bg-border flex-1" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" && (
              <>
                <Input value={name} onChange={setName} placeholder="Your name" required />
                <Input value={business} onChange={setBusiness} placeholder="Business name" required />
              </>
            )}
            <Input value={email} onChange={setEmail} type="email" placeholder="you@business.com" required />
            <Input value={password} onChange={setPassword} type="password" placeholder="Password (min 6 chars)" required minLength={6} />
            <button
              type="submit"
              disabled={busy}
              className="w-full pill bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-5 w-full text-center text-sm text-ink-soft hover:text-foreground"
          >
            {mode === "signin" ? "No account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </main>
    </div>
  );
}

function Input({
  value, onChange, ...rest
}: {
  value: string;
  onChange: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <input
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm outline-none focus:border-foreground transition"
    />
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.08-1.92 3.28-4.74 3.28-8.07z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.75c-.99.66-2.26 1.06-3.71 1.06-2.85 0-5.27-1.92-6.13-4.5H2.18v2.84A11 11 0 0 0 12 23z"/>
      <path fill="#FBBC05" d="M5.87 14.15A6.6 6.6 0 0 1 5.5 12c0-.75.13-1.47.36-2.15V7.01H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.99l3.69-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.46 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.01l3.69 2.84C6.73 7.3 9.15 5.38 12 5.38z"/>
    </svg>
  );
}
