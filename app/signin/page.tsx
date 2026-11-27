export default function SignIn() {
  return (
    <main style={{ maxWidth: 440, margin: "12vh auto", padding: 24 }}>
      <div className="card stack">
        <h1>Frame Hub</h1>
        <p className="muted">Sign-in isn’t connected yet. Frame Hub will use your Microsoft 365 or Google work account — see “Sign-in” in the README.</p>
        <p className="small faint">Local development uses a stand-in user (AUTH_PROVIDER=dev).</p>
      </div>
    </main>
  );
}
