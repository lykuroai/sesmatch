"use client";

import { useState } from "react";
import { RemoteLevelSelect } from "./RemoteLevelSelect";
import { useRouter } from "next/navigation";
import { AFFILIATION_LABELS } from "@/lib/constants";

const input = "w-full rounded border border-slate-300 px-3 py-2 text-sm";
const label = "mb-1 block text-sm font-medium";

export type EngineerFormInitial = {
  name?: string; // PII権限がない場合は undefined
  ageBand: number;
  affiliationType: string;
  residenceCity?: string | null;
  nationality?: string | null;
  availableFrom?: string | null; // YYYY-MM-DD
  desiredRateMan?: number; // 万円
  remotePreference: string;
  processes: string[];
  industries: string[];
  skills: { name: string; category: string; months: number }[];
  summary?: string;
};

export function EngineerForm({
  engineerId,
  initial,
  currentSheetName,
}: {
  engineerId?: string; // 指定時は編集モード（PUT）
  initial?: EngineerFormInitial;
  currentSheetName?: string | null; // 編集時: 添付済み職務経歴書のファイル名
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reExtracting, setReExtracting] = useState(false);
  const isEdit = !!engineerId;

  // 添付済みの職務経歴書から匿名化テキスト・抽出値を再抽出する（LLM再抽出ボタン）
  async function reExtract() {
    if (
      !confirm(
        "添付済みの職務経歴書からLLMで再抽出します。\n未登録スキルの追加と未入力プロフィール項目の反映を行い、スキルの経験月数は経歴書からの推定値で上書きされます。よろしいですか？"
      )
    )
      return;
    setReExtracting(true);
    const rx = await fetch(`/api/v1/engineers/${engineerId}/skill-sheet/re-extract`, {
      method: "POST",
    });
    setReExtracting(false);
    const rb = await rx.json().catch(() => null);
    if (!rx.ok) {
      alert(`再抽出に失敗しました: ${rb?.error?.message ?? "エラー"}`);
    } else if (rb?.extractWarning) {
      alert(`再抽出できませんでした: ${rb.extractWarning}`);
    } else {
      alert(
        `再抽出しました（スキル追加 ${rb?.addedSkills ?? 0}件 / 経験月数補完 ${rb?.updatedMonths ?? 0}件）`
      );
      router.refresh();
      // 編集フォームの初期値を再抽出後の値に更新するためリロード
      window.location.reload();
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const skills = String(f.get("skills") ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        // 形式: 名称,分類,経験月数（例: Java,LANGUAGE,60）
        const [name, category = "LANGUAGE", months = "12"] = line.split(",").map((s) => s.trim());
        return { name, category, months: parseInt(months) || 0 };
      });

    const name = String(f.get("name") ?? "").trim();
    const payload = {
      ...(name ? { name } : {}),
      ageBand: parseInt(String(f.get("ageBand"))),
      affiliationType: f.get("affiliationType"),
      residenceCity: f.get("residenceCity") || undefined,
      nationality: f.get("nationality") || undefined,
      availableFrom: f.get("availableFrom") || undefined,
      desiredRateYen: parseInt(String(f.get("desiredRateYen"))) * 10_000,
      // 週最大出社日数は許容出社条件から自動導出（サーバー側で連動）
      remotePreference: f.get("remotePreference"),
      summary: f.get("summary") || undefined,
      processes: String(f.get("processes") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      industries: String(f.get("industries") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      skills,
    };

    const res = await fetch(isEdit ? `/api/v1/engineers/${engineerId}` : "/api/v1/engineers", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      setLoading(false);
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "保存に失敗しました");
      return;
    }
    const saved = await res.json();

    // 職務経歴書（スキルシート）が選択されていれば続けてアップロード
    const sheet = f.get("skillSheet");
    if (sheet instanceof File && sheet.size > 0) {
      const fd = new FormData();
      fd.append("file", sheet);
      const up = await fetch(`/api/v1/engineers/${saved.id ?? engineerId}/skill-sheet`, {
        method: "POST",
        body: fd,
      });
      if (!up.ok) {
        setLoading(false);
        const b = await up.json().catch(() => null);
        setError(
          `人材は保存しましたが、職務経歴書の添付に失敗しました: ${b?.error?.message ?? "エラー"}`
        );
        return;
      }
      // 内容の自動反映に失敗した場合は警告を表示してから遷移する（添付自体は保存済み）
      const ub = await up.json().catch(() => null);
      if (ub?.extractWarning) {
        alert(`職務経歴書を添付しましたが、内容の自動反映はできませんでした:\n${ub.extractWarning}`);
      }
    }
    setLoading(false);
    router.push(`/engineers/${saved.id ?? engineerId}`);
    router.refresh();
  }

  const skillLines = initial?.skills
    ?.map((s) => `${s.name},${s.category},${s.months}`)
    .join("\n");

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>氏名（PII・Level 2まで非開示）</label>
          <input
            name="name"
            required={!isEdit}
            defaultValue={initial?.name ?? ""}
            className={input}
            placeholder={isEdit && initial?.name === undefined ? "（PII権限がないため変更不可）" : ""}
            disabled={isEdit && initial?.name === undefined}
          />
        </div>
        <div>
          <label className={label}>年代（5歳刻み下限）</label>
          <select name="ageBand" className={input} defaultValue={String(initial?.ageBand ?? 30)}>
            {[20, 25, 30, 35, 40, 45, 50, 55, 60].map((a) => (
              <option key={a} value={a}>{a}〜{a + 4}歳</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>所属区分</label>
          <select name="affiliationType" className={input} defaultValue={initial?.affiliationType ?? "EMPLOYEE"}>
            {Object.entries(AFFILIATION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>居住市区町村</label>
          <input name="residenceCity" defaultValue={initial?.residenceCity ?? ""} className={input} placeholder="例: 川崎市" />
        </div>
        <div>
          <label className={label}>国籍（外国籍の場合は国名を明記）</label>
          <input
            name="nationality"
            defaultValue={initial?.nationality ?? ""}
            className={input}
            placeholder="未入力の場合は日本国籍とみなします"
          />
        </div>
        <div>
          <label className={label}>稼働可能日</label>
          <input type="date" name="availableFrom" defaultValue={initial?.availableFrom ?? ""} className={input} />
        </div>
        <div>
          <label className={label}>希望単価（万円/月）</label>
          <input
            type="number"
            name="desiredRateYen"
            required
            min={10}
            defaultValue={initial?.desiredRateMan ?? ""}
            className={input}
            placeholder="65"
          />
        </div>
        <div>
          <label className={label}>許容出社条件</label>
          <RemoteLevelSelect
            name="remotePreference"
            initial={initial?.remotePreference ?? "R0"}
            daysLabel="週最大出社日数"
            showCode
            className={input}
          />
        </div>
      </div>
      <div>
        <label className={label}>工程（カンマ区切り）</label>
        <input name="processes" defaultValue={initial?.processes.join(", ") ?? ""} className={input} placeholder="基本設計, 開発, テスト" />
      </div>
      <div>
        <label className={label}>業種経験（カンマ区切り）</label>
        <input name="industries" defaultValue={initial?.industries.join(", ") ?? ""} className={input} placeholder="金融, 通信" />
      </div>
      <div>
        <label className={label}>スキル（1行1件: 名称,分類,経験月数）</label>
        <textarea
          name="skills"
          rows={5}
          defaultValue={skillLines ?? ""}
          className={input}
          placeholder={"Java,LANGUAGE,60\nSpring Boot,FRAMEWORK,36\nAWS,CLOUD,24"}
        />
        <p className="mt-1 text-xs text-slate-400">
          分類: LANGUAGE / FRAMEWORK / DATABASE / CLOUD / OS / TOOL / CERTIFICATION（経験不明は 0）
        </p>
      </div>
      <div>
        <label className={label}>匿名概要（企業名・氏名を含めないこと）</label>
        <textarea name="summary" rows={3} defaultValue={initial?.summary ?? ""} className={input} />
      </div>
      <div>
        <label className={label}>職務経歴書（スキルシート）添付（任意・Excel/Word/PDF・10MBまで）</label>
        <input type="file" name="skillSheet" accept=".pdf,.doc,.docx,.xls,.xlsx" className={input} />
        <p className="mt-1 text-xs text-slate-500">
          内容を自動解析し、未登録のスキルをマッチング対象に追加します（既存の入力は上書きしません）。
          原本の閲覧は自社のPII権限保持者のみ。
          {currentSheetName && `現在の添付: ${currentSheetName}（新しいファイルを選ぶと差し替え）`}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={loading || reExtracting}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "保存中..." : isEdit ? "更新する" : "登録する"}
        </button>
        {isEdit && currentSheetName && (
          <button
            type="button"
            onClick={reExtract}
            disabled={loading || reExtracting}
            className="rounded border border-emerald-600 bg-white px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            title="添付済みの職務経歴書から匿名化テキスト・抽出値を再抽出します"
          >
            {reExtracting ? "再抽出中..." : "LLM再抽出"}
          </button>
        )}
      </div>
    </form>
  );
}
