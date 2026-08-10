"use client";

// 居住エリア・勤務地の入力（都道府県は選択、市区町村は入力）。
// 保存値は「東京都千代田区」形式の1文字列（hidden input で送信）
import { useState } from "react";
import { PREFECTURES } from "@/lib/constants";

export function LocationInput({
  name,
  initial,
  cityPlaceholder,
  className,
}: {
  name: string;
  initial?: string | null;
  cityPlaceholder?: string;
  className?: string;
}) {
  const init = initial ?? "";
  const initPref = PREFECTURES.find((p) => init.startsWith(p)) ?? "";
  const [pref, setPref] = useState(initPref);
  const [city, setCity] = useState(initPref ? init.slice(initPref.length) : init);
  return (
    <div className="flex gap-2">
      <input type="hidden" name={name} value={`${pref}${city.trim()}`} />
      <select value={pref} onChange={(e) => setPref(e.target.value)} className={className}>
        <option value="">都道府県</option>
        {PREFECTURES.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <input
        value={city}
        onChange={(e) => setCity(e.target.value)}
        placeholder={cityPlaceholder ?? "市区町村"}
        className={className}
      />
    </div>
  );
}
