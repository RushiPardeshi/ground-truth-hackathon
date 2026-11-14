import AccountView from "./AccountView";

export default async function Page({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { key } = await params;
  const sp = await searchParams;
  return <AccountView accountKey={decodeURIComponent(key)} runId={sp.run} shared={sp.shared === "1"} savedCalls={Number(sp.saved || 0)} savedCost={Number(sp.cost || 0)} showTrace={sp.trace === "1"} />;
}
