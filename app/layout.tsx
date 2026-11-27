import "./globals.css";
import type { Metadata, Viewport } from "next";
import { SideNav, TabBar } from "@/components/Nav";
import { currentUser, authProvider } from "@/lib/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export const metadata: Metadata = { title: { default: "Frame Hub", template: "%s · Frame Hub" }, description: "Frame Architecture — proposals, sales, projects" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get("x-pathname") ?? "";
  const bare = path.startsWith("/p/") || path.startsWith("/signin");
  if (bare) return <html lang="en"><body>{children}</body></html>;
  const user = await currentUser();
  if (!user) redirect(authProvider().signInUrl(path));
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <SideNav user={user} />
          <main className="main">{children}</main>
        </div>
        <TabBar />
      </body>
    </html>
  );
}
