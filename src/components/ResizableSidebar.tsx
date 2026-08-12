"use client";

// 左メニュー（サイドバー）の幅をドラッグで調整できるラッパー。
// 右端のハンドルを左右にドラッグすると幅が変わり、localStorage に保存して次回表示でも維持する
import { useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "console-sidebar-width";
const MIN_PX = 160;
const MAX_PX = 480;
const DEFAULT_PX = 240; // 従来の w-60 相当

const clamp = (v: number) => Math.min(MAX_PX, Math.max(MIN_PX, v));

export function ResizableSidebar({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(DEFAULT_PX);

  useEffect(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (saved >= MIN_PX && saved <= MAX_PX) setWidth(saved);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => setWidth(clamp(ev.clientX));
    const up = (ev: PointerEvent) => {
      localStorage.setItem(STORAGE_KEY, String(clamp(ev.clientX)));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    // モバイル（md未満）ではサイドバーを出さずドロワーメニュー（MobileNav）を使う
    <div className="relative hidden shrink-0 md:flex print:hidden" style={{ width }}>
      <aside className="min-w-0 flex-1 overflow-x-hidden border-r border-slate-200 bg-white">
        {children}
      </aside>
      <div
        onPointerDown={onPointerDown}
        title="ドラッグで幅を調整"
        className="group absolute inset-y-0 -right-1.5 z-10 flex w-3 cursor-col-resize items-center justify-center"
      >
        <div className="h-16 w-1 rounded-full bg-transparent group-hover:bg-blue-400" />
      </div>
    </div>
  );
}
