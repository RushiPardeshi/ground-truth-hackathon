"use client";
import { useEffect, useState } from "react";
import { USERS } from "@/lib/config";

export function useUser(): [string, (u: string) => void] {
  const [user, setUser] = useState(USERS[0]);
  useEffect(() => {
    try {
      const u = localStorage.getItem("tw_user");
      if (u) setUser(u);
    } catch {}
  }, []);
  const set = (u: string) => {
    setUser(u);
    try {
      localStorage.setItem("tw_user", u);
    } catch {}
  };
  return [user, set];
}

export function UserPicker({ user, setUser }: { user: string; setUser: (u: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-500">
      Signed in as
      <select value={user} onChange={(e) => setUser(e.target.value)} className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900">
        {USERS.map((u) => (
          <option key={u}>{u}</option>
        ))}
      </select>
    </label>
  );
}

export function ago(iso?: string | null): string {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function VerdictBadge({ verdict, score }: { verdict?: string | null; score?: number | null }) {
  const c =
    verdict === "Hot" ? "bg-red-100 text-red-800 border-red-200" :
    verdict === "Warm" ? "bg-amber-100 text-amber-800 border-amber-200" :
    verdict === "Cold" ? "bg-sky-100 text-sky-800 border-sky-200" :
    "bg-zinc-100 text-zinc-600 border-zinc-200";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${c}`}>
      {score ?? "–"} · {verdict ?? "Not researched"}
    </span>
  );
}

export function Logo() {
  return (
    <a href="/" className="flex items-center gap-2 font-semibold tracking-tight text-zinc-900">
      <span className="inline-block h-3 w-3 rotate-45 bg-red-600" />
      Tripwire
    </a>
  );
}
