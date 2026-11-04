import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";
import { joinMeeting } from "@/server/services/meetings";
import { JitsiRoom } from "@/components/JitsiRoom";

// 担当者の Web 会議参加画面（PRO版仕様書 §4.8）。参加 JWT はサーバー側で発行する
export default async function MeetingPage({ params }: { params: Promise<{ id: string; interviewId: string }> }) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const { id, interviewId } = await params;
  const r = await joinMeeting(auth, interviewId);
  if ("error" in r) {
    if (r.error?.code === "NOT_FOUND") notFound();
    return (
      <div>
        <Link href={`/entries/${id}`} className="text-sm text-blue-700 hover:underline">← 商談に戻る</Link>
        <p className="mt-4 rounded bg-amber-50 p-3 text-sm text-amber-800">{r.error?.message ?? "参加できません"}。外部の会議ツールをご利用ください。</p>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Link href={`/entries/${id}`} className="text-sm text-blue-700 hover:underline">← 商談に戻る</Link>
        <p className="text-xs text-slate-500">録画・文字起こしは行いません。会話内容は保存されません。</p>
      </div>
      <JitsiRoom domain={r.domain} room={r.room} token={r.token} />
    </div>
  );
}
