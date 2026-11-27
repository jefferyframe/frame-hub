import "./globals.css";
import type { Metadata, Viewport } from "next";
import { SideNav, TabBar } from "@/components/Nav";
import { currentUser, authProvider } from "@/lib/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Suspense } from "react";
import { CardHost } from "@/components/project/CardHost";
import { getDb } from "@/lib/db";
import { myMissing } from "@/lib/repo/time";

export const metadata: Metadata = { title: { default: "Frame Hub", template: "%s · Frame Hub" }, description: "Frame Architecture — proposals, sales, projects" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get("x-pathname") ?? "";
  const bare = path.startsWith("/p/") || path.startsWith("/signin");
  if (bare) return <html lang="en"><body>{children}</body></html>;
  const user = await currentUser();
  if (!user) redirect(authProvider().signInUrl(path));
  // Days this week the signed-in person is short on hours → badge on "My timesheet".
  let hoursDue = 0;
  try { hoursDue = (await myMissing(await getDb(), user.name))?.missing.length ?? 0; } catch { hoursDue = 0; }
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <SideNav user={user} hoursDue={hoursDue} />
          <main className="main">{children}</main>
        </div>
        <TabBar hoursDue={hoursDue} />
        <Suspense fallback={null}><CardHost /></Suspense>
      </body>
    </html>
  );
}
