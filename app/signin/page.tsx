import { sendLinkAction, verifyCodeAction, passwordAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in", robots: { index: false } };

const ERRORS: Record<string, string> = {
  notallowed: "That email doesn’t have access to Frame Hub.",
  mailer: "Sign-in emails can’t be delivered to this address yet (Frame Hub’s email sender only reaches approved addresses). Use your password instead, or ask Jeff to enable email for you.",
  rate: "Too many sign-in emails were sent in the last hour. Wait a bit, or use the code from the last email.",
  send: "The sign-in email couldn’t be sent. Try again in a minute.",
  code: "That code didn’t work or has expired. Check the newest email, or send a new one.",
  password: "Email or password is incorrect.",
  browser: "Open the sign-in link in the same browser you requested it from — or type the 6-digit code from the email below.",
  expired: "That sign-in link has expired or was already used. Send a new one.",
  link: "That sign-in link is incomplete. Send a new one.",
  config: "Sign-in isn’t configured on this server yet.",
};

export default async function SignIn({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const next = q.next ?? "/";
  const email = q.email ?? "";
  const error = q.error ? ERRORS[q.error] ?? "Sign-in failed." : null;
  const sent = q.sent === "1" || q.error === "browser";
  const pwMode = q.mode === "password";
  return (
    <main style={{ maxWidth: 440, margin: "10vh auto", padding: 24 }}>
      <div className="card stack">
        <h1>Frame Hub</h1>
        {q.out && <p className="muted">You’re signed out.</p>}
        {error && <p className="notice warn" role="alert">{error}</p>}

        {pwMode ? (
          <form action={passwordAction} className="stack">
            <input type="hidden" name="next" value={next} />
            <label className="stack" style={{ gap: 4 }}>Work email<input className="input" type="email" name="email" defaultValue={email} required autoComplete="email" /></label>
            <label className="stack" style={{ gap: 4 }}>Password<input className="input" type="password" name="password" required autoComplete="current-password" /></label>
            <button className="btn primary" type="submit">Sign in</button>
            <a className="small" href={`/signin?${new URLSearchParams({ next, email })}`}>Email me a sign-in link instead</a>
          </form>
        ) : sent ? (
          <>
            <p className="muted">{email ? <>We emailed a sign-in link to <b>{email}</b>.</> : "Check your email."} Tap the link on this device, or type the 6-digit code from the email.</p>
            <form action={verifyCodeAction} className="stack">
              <input type="hidden" name="next" value={next} />
              <label className="stack" style={{ gap: 4 }}>Email<input className="input" type="email" name="email" defaultValue={email} required autoComplete="email" /></label>
              <label className="stack" style={{ gap: 4 }}>Code<input className="input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,10}" required /></label>
              <button className="btn primary" type="submit">Sign in</button>
            </form>
            <a className="small" href={`/signin?${new URLSearchParams({ next, email })}`}>Send a new email</a>
          </>
        ) : (
          <form action={sendLinkAction} className="stack">
            <input type="hidden" name="next" value={next} />
            <label className="stack" style={{ gap: 4 }}>Work email<input className="input" type="email" name="email" defaultValue={email} required autoComplete="email" /></label>
            <button className="btn primary" type="submit">Email me a sign-in link</button>
            <a className="small" href={`/signin?${new URLSearchParams({ next, email, mode: "password" })}`}>Sign in with a password</a>
          </form>
        )}
        <p className="small faint">Access is limited to Frame Architecture’s team.</p>
      </div>
    </main>
  );
}
