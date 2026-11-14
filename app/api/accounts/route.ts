import { NextResponse } from "next/server";
import { listAccounts, totalSavings } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ accounts: listAccounts(), savings: totalSavings() });
}
