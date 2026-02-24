"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./NavTabs.module.css";

const TABS = [
  { href: "/generate", label: "Generate Speech" },
  { href: "/voices", label: "Voice Library" },
  { href: "/clone", label: "Clone a Voice" },
  { href: "/podcast", label: "🎙 Podcast" },
];

export function NavTabs() {
  const pathname = usePathname();

  return (
    <div className={styles.tabs} role="tablist">
      {TABS.map((tab) => {
        const active =
          pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active}
            className={`${styles.tab} ${active ? styles.active : ""}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
