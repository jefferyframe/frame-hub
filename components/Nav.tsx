"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconHome, IconDoc, IconFunnel, IconUsers, IconChart, IconMega, IconBuild, IconCog, IconBook, IconCrm, IconGrid, IconClock, IconGantt, IconAlert } from "./icons";

const GROUPS = [
  { items: [{ href: "/", label: "Dashboard", Icon: IconHome }] },
  { title: "Proposals", items: [{ href: "/proposals", label: "Proposals", Icon: IconDoc }, { href: "/proposals/library", label: "Line items & precedents", Icon: IconBook }] },
  { title: "Sales", items: [
    { href: "/crm", label: "CRM", Icon: IconCrm },
    { href: "/sales", label: "Pipeline sheet", Icon: IconFunnel },
    { href: "/sales/contacts", label: "Contacts", Icon: IconUsers },
    { href: "/crm/companies", label: "Companies", Icon: IconGrid },
    { href: "/sales/measures", label: "Lead & lag measures", Icon: IconChart },
    { href: "/sales/outreach", label: "Outreach", Icon: IconMega },
  ] },
  { title: "Projects", items: [
    { href: "/projects", label: "Job list", Icon: IconBuild },
    { href: "/timesheet", label: "My timesheet", Icon: IconClock },
    { href: "/schedule", label: "Schedule", Icon: IconGantt },
    { href: "/timesheet/missing", label: "Missing hours", Icon: IconAlert },
  ] },
  { items: [{ href: "/settings", label: "Settings", Icon: IconCog }] },
];

const isOn = (path: string, href: string) => (href === "/" ? path === "/" : path === href || (path.startsWith(href + "/") && !GROUPS.flatMap((g) => g.items).some((i) => i.href !== href && i.href.startsWith(href + "/") && path.startsWith(i.href))));

const Badge = ({ n, label }: { n: number; label: string }) => (n > 0 ? <span className="nbadge" aria-label={label}>{n}</span> : null);

export function SideNav({ user, hoursDue = 0 }: { user: { name: string; email: string }; hoursDue?: number }) {
  const path = usePathname();
  return (
    <aside className="side">
      <div className="brand"><div className="mark">F</div><div><b>Frame Hub</b><span>Frame Architecture</span></div></div>
      <nav className="nav">
        {GROUPS.map((g, i) => (
          <div key={i}>
            {g.title && <div className="group label">{g.title}</div>}
            {g.items.map(({ href, label, Icon }) => (
              <Link key={href} href={href} aria-current={isOn(path, href) ? "page" : undefined}><Icon />{label}{href === "/timesheet" && <Badge n={hoursDue} label={`${hoursDue} days short on hours`} />}</Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="user"><div>{user.name}</div>{user.email && <div className="faint">{user.email}</div>}
        <form action="/auth/signout" method="post"><button className="btn small" type="submit" style={{ marginTop: 8 }}>Sign out</button></form></div>
    </aside>
  );
}

const TABS = [
  { href: "/", label: "Home", Icon: IconHome },
  { href: "/proposals", label: "Proposals", Icon: IconDoc },
  { href: "/crm", label: "CRM", Icon: IconCrm },
  { href: "/sales", label: "Pipeline", Icon: IconFunnel },
  { href: "/projects", label: "Jobs", Icon: IconBuild },
  { href: "/timesheet", label: "Hours", Icon: IconClock },
];
export function TabBar({ hoursDue = 0 }: { hoursDue?: number }) {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label="Sections">
      {TABS.map(({ href, label, Icon }) => (
        <Link key={href} href={href} aria-current={(href === "/" ? path === "/" : path === href || path.startsWith(href + "/")) ? "page" : undefined}><span className="ticon"><Icon />{href === "/timesheet" && <Badge n={hoursDue} label={`${hoursDue} days short on hours`} />}</span>{label}</Link>
      ))}
    </nav>
  );
}
