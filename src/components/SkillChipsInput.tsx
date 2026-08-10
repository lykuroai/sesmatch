"use client";

// スキルのチップ入力（検索フォーム用）。選択済みスキルは hidden input にカンマ区切りで入り、
// GET フォームの送信でそのままクエリパラメータになる
import { useState } from "react";

export function SkillChipsInput({ name, initial }: { name: string; initial: string[] }) {
  const [skills, setSkills] = useState(initial);
  const [draft, setDraft] = useState("");

  const add = () => {
    const v = draft.trim();
    if (v && !skills.some((s) => s.toLowerCase() === v.toLowerCase())) setSkills([...skills, v]);
    setDraft("");
  };

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name={name} value={skills.join(",")} />
      {skills.map((s) => (
        <span key={s} className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-sm text-blue-800">
          {s}
          <button
            type="button"
            aria-label={`${s} を削除`}
            onClick={() => setSkills(skills.filter((x) => x !== s))}
            className="text-blue-400 hover:text-blue-800"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        placeholder="スキル名"
        className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
      />
      <button
        type="button"
        onClick={add}
        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
      >
        ＋追加
      </button>
    </span>
  );
}
