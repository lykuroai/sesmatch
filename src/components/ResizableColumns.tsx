"use client";

// 2カラムの幅をドラッグで調整できるレイアウト。
// 中央のハンドルを左右にドラッグすると比率が変わり、localStorage に保存して次回表示でも維持する
import { useEffect, useRef, useState, type ReactNode } from "react";

const MIN_PCT = 20;
const MAX_PCT = 80;

export function ResizableColumns({
  storageKey,
  left,
  right,
}: {
  storageKey: string;
  left: ReactNode;
  right: ReactNode;
}) {
  const [ratio, setRatio] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = Number(localStorage.getItem(storageKey));
    if (saved >= MIN_PCT && saved <= MAX_PCT) setRatio(saved);
  }, [storageKey]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const move = (ev: PointerEvent) => {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setRatio(Math.min(MAX_PCT, Math.max(MIN_PCT, pct)));
    };
    const up = (ev: PointerEvent) => {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      localStorage.setItem(storageKey, String(Math.min(MAX_PCT, Math.max(MIN_PCT, pct))));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    // モバイル（md未満）は縦積み・幅調整なし。md以上で従来の2カラム＋ドラッグ調整
    <div
      ref={containerRef}
      className="flex flex-col gap-4 md:flex-row md:items-stretch md:gap-0"
      style={{ "--left-w": `${ratio}%` } as React.CSSProperties}
    >
      <div className="min-w-0 md:w-[var(--left-w)]">{left}</div>
      <div
        onPointerDown={onPointerDown}
        title="ドラッグで幅を調整"
        className="group hidden w-6 shrink-0 cursor-col-resize items-center justify-center md:flex"
      >
        <div className="h-16 w-1 rounded-full bg-slate-300 group-hover:bg-blue-400" />
      </div>
      <div className="min-w-0 md:flex-1">{right}</div>
    </div>
  );
}
