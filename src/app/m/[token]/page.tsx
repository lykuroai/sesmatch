import { peekGuestMeeting } from "@/server/services/meetings";
import { GuestJoin } from "@/components/GuestJoin";

// 人材本人のゲスト参加ページ（PRO版仕様書 §4.8）。ログイン不要。表示名を入力して iframe で会議に参加する
export const metadata = { title: "Web 会議に参加", robots: { index: false, follow: false } };

export default async function GuestMeetingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await peekGuestMeeting(token);
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-xl font-bold text-slate-900">SES DirectMatch — Web 会議</h1>
        {!info ? (
          <p className="mt-4 rounded bg-white p-4 text-sm text-slate-700 shadow-sm">この参加 URL は無効です。送付元の企業にご確認ください。</p>
        ) : (
          <GuestJoin token={token} scheduledAt={info.scheduledAt.toISOString()} validFrom={info.validFrom.toISOString()} validTo={info.validTo.toISOString()} open={info.open} available={info.available} />
        )}
        <p className="mt-6 text-xs text-slate-500">録画・文字起こしは行わず、会話内容は保存されません。この会議は本プラットフォーム利用企業との面談のために提供されています。</p>
      </div>
    </main>
  );
}
