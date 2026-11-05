"use client";

// Jitsi Meet をコンソール内に埋め込む（PRO版仕様書 §4.8）。external_api.js を自前ドメインから読み込み、JWT で入室する。
// 録画・文字起こしは行わない。離脱時に API を破棄する
import { useEffect, useRef, useState } from "react";

type JitsiApi = { dispose: () => void; addListener: (ev: string, cb: () => void) => void };
type JitsiCtor = new (domain: string, opts: Record<string, unknown>) => JitsiApi;

export function JitsiRoom({ domain, room, token, onLeave }: { domain: string; room: string; token: string; onLeave?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let api: JitsiApi | null = null;
    let cancelled = false;
    const start = () => {
      if (cancelled || !ref.current) return;
      const Ctor = (window as unknown as { JitsiMeetExternalAPI?: JitsiCtor }).JitsiMeetExternalAPI;
      if (!Ctor) return setError("会議コンポーネントを読み込めませんでした");
      api = new Ctor(domain, {
        roomName: room,
        jwt: token,
        parentNode: ref.current,
        width: "100%",
        height: "100%",
        lang: "ja",
        configOverwrite: { prejoinConfig: { enabled: true }, disableDeepLinking: true, fileRecordingsEnabled: false, liveStreamingEnabled: false },
        interfaceConfigOverwrite: { SHOW_JITSI_WATERMARK: false, TOOLBAR_BUTTONS: ["microphone", "camera", "desktop", "chat", "participants-pane", "tileview", "hangup", "settings"] },
      });
      api.addListener("videoConferenceLeft", () => onLeave?.());
    };
    const existing = document.querySelector<HTMLScriptElement>(`script[data-jitsi="${domain}"]`);
    if (existing && (window as unknown as { JitsiMeetExternalAPI?: unknown }).JitsiMeetExternalAPI) start();
    else {
      const s = existing ?? document.createElement("script");
      if (!existing) {
        s.src = `https://${domain}/external_api.js`;
        s.async = true;
        s.dataset.jitsi = domain;
        document.body.appendChild(s);
      }
      s.addEventListener("load", start);
      s.addEventListener("error", () => setError("会議サーバーに接続できません。外部の会議ツールをご利用ください"));
    }
    return () => {
      cancelled = true;
      api?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, room, token]);
  return (
    <div className="h-[70vh] min-h-[480px] w-full overflow-hidden rounded-xl border border-stone-200 bg-stone-900">
      {error ? <p className="p-6 text-sm text-white">{error}</p> : <div ref={ref} className="h-full w-full" />}
    </div>
  );
}
