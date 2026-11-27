"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconHome, IconDoc, IconFunnel, IconUsers, IconCheck, IconChart, IconMega, IconBuild, IconCog, IconBook } from "./icons";

const GROUPS = [
  { items: [{ href: "/", label: "Dashboard", Icon: IconHome }] },
  { title: "Proposals", items: [{ href: "/proposals", label: "Proposals", Icon: IconDoc }, { href: "/proposals/library", label: "Line items & precedents", Icon: IconBook }] },
  { title: "Sales", items: [
    { href: "/sales", label: "Pipeline", Icon: IconFunnel },
    { href: "/sales/follow-ups", label: "Follow-ups", Icon: IconCheck },
    { href: "/sales/contacts", label: "Contacts", Icon: IconUsers },
    { href: "/sales/measures", label: "Lead & lag measures", Icon: IconChart },
    { href: "/sales/outreach", label: "Outreach", Icon: IconMega },
  ] },
  { title: "Projects", items: [{ href: "/projects", label: "Job list", Icon: IconBuild }] },
  { items: [{ href: "/settings", label: "Settings", Icon: IconCog }] },
];

const isOn = (path: string, href: string) => (href === "/" ? path === "/" : path === href || (path.startsWith(href + "/") && !GROUPS.flatMap((g) => g.items).some((i) => i.href !== href && i.href.startsWith(href + "/") && path.startsWith(i.href))));

export function SideNav({ user }: { user: { name: string; email: string } }) {
  const path = usePathname();
  return (
    <aside className="side">
      <div className="brand"><div className="mark">F</div><div><b>Frame Hub</b><span>Frame Architecture</span></div></div>
      <nav className="nav">
        {GROUPS.map((g, i) => (
          <div key={i}>
            {g.title && <div className="group label">{g.title}</div>}
            {g.items.map(({ href, label, Icon }) => (
              <Link key={href} href={href} aria-current={isOn(path, href) ? "page" : undefined}><Icon />{label}</Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="user"><div>{user.name}</div><div className="faint">{user.email}</div></div>
    </aside>
  );
}

const TABS = [
  { href: "/", label: "Home", Icon: IconHome },
  { href: "/proposals", label: "Proposals", Icon: IconDoc },
  { href: "/sales", label: "Sales", Icon: IconFunnel },
  { href: "/sales/follow-ups", label: "Follow-ups", Icon: IconCheck },
  { href: "/projects", label: "Jobs", Icon: IconBuild },
];
export function TabBar() {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label="Sections">
      {TABS.map(({ href, label, Icon }) => (
        <Link key={href} href={href} aria-current={(href === "/" ? path === "/" : path.startsWith(href) && !(href === "/sales" && path.startsWith("/sales/follow-ups"))) ? "page" : undefined}><Icon />{label}</Link>
      ))}
    </nav>
  );
}
