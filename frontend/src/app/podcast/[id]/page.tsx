import { EpisodePage } from "@/components/podcast/EpisodePage";

// Next.js 15+ passes params as a Promise for server components.
// EpisodePage is a client component, so we unwrap here server-side.
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EpisodePage id={id} />;
}
