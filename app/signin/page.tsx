import { signInAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in", robots: { index: false } };

const ERRORS: Record<string, string> = {
  password: "That password isn’t right.",
  name: "Please enter your first name.",
  locked: "Too many wrong tries. Wait 15 minutes and try again.",
  config: "Sign-in isn’t configured on this server yet.",
};

export default async function SignIn({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const error = q.error ? ERRORS[q.error] ?? "Sign-in failed." : null;
  return (
    <main style={{ maxWidth: 400, margin: "10vh auto", padding: 24 }}>
      <form action={signInAction} className="card stack">
        <h1>Frame Hub</h1>
        {q.out && <p className="muted">You’re signed out.</p>}
        {error && <p className="notice bad" role="alert">{error}</p>}
        <input type="hidden" name="next" value={q.next ?? "/"} />
        <label className="stack" style={{ gap: 4 }}>First name
          <input name="name" defaultValue={q.name ?? ""} required maxLength={40} autoComplete="given-name" />
        </label>
        <label className="stack" style={{ gap: 4 }}>Password
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        <button className="btn primary" type="submit">Sign in</button>
      </form>
    </main>
  );
}
