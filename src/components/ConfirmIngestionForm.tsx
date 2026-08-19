"use client";

// 人手確認フォーム（§9.2: LLM抽出値を担当者が確認・修正してから確定DBへ反映）
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AFFILIATION_LABELS,
  remoteLevelFromOnsiteDays,
  remoteLevelToOnsiteDays,
} from "@/lib/constants";
import { RemoteLevelSelect } from "./RemoteLevelSelect";
import { LocationInput } from "./LocationInput";

const input = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const label = "mb-1 block text-xs text-slate-500";

type EngineerDraft = {
  kind: "ENGINEER_SHEET";
  name?: string | null; // 氏名（LLM抽出。2026-08-19の送信禁止撤廃後の抽出結果のみ持つ）
  affiliationType: string | null;
  ageBand: number | null;
  nationality?: string | null; // 国籍（国名。未指定は日本国籍とみなす）
  residenceCity: string | null;
  availableFrom: string | null;
  desiredRateYen: number | null;
  maxOnsiteDaysPerWeek: number | null;
  skills: { category: string; name: string; months: number | null; monthsEstimated?: boolean }[];
  processes: string[];
  roles?: string[];
  industries?: string[];
  summary: string;
};

type ProjectDraft = {
  kind: "PROJECT_DESCRIPTION";
  name: string | null;
  startDate: string | null;
  rateMaxYen: number | null;
  onsiteDaysPerWeek: number | null;
  locationCity?: string | null; // 勤務地（都道府県から）。既存の抽出結果には無い場合がある
  noForeignNational?: boolean | null; // 外国籍不可（true=不可）。既存の抽出結果には無い場合がある
  requiredSkills: string[];
  preferredSkills: string[];
  summary: string;
};

export function ConfirmIngestionForm({
  jobId,
  kind,
  extracted,
}: {
  jobId: string;
  kind: "ENGINEER_SHEET" | "PROJECT_DESCRIPTION";
  extracted: EngineerDraft | ProjectDraft;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const num = (k: string) => {
      const v = String(f.get(k) ?? "").trim();
      return v === "" ? null : parseInt(v);
    };
    const list = (k: string) =>
      String(f.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

    let body: Record<string, unknown>;
    if (kind === "ENGINEER_SHEET") {
      const skills = String(f.get("skills") ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [name, category = "LANGUAGE", months = "0"] = line.split(",").map((s) => s.trim());
          return { name, category, months: months === "" ? null : parseInt(months) || 0 };
        });
      const confirmed: EngineerDraft = {
        kind: "ENGINEER_SHEET",
        affiliationType: String(f.get("affiliationType")) || null,
        ageBand: num("ageBand"),
        nationality: String(f.get("nationality") ?? "").trim() || null,
        residenceCity: String(f.get("residenceCity") ?? "").trim() || null,
        availableFrom: String(f.get("availableFrom") ?? "").trim() || null,
        desiredRateYen: num("desiredRateYen"),
        // 週最大出社日数は許容出社条件から自動導出（画面入力は許容出社条件に一本化）
        maxOnsiteDaysPerWeek: remoteLevelToOnsiteDays(String(f.get("remotePreference"))),
        skills,
        processes: list("processes"),
        roles: list("roles"),
        industries: list("industries"),
        summary: String(f.get("summary") ?? ""),
      };
      body = { name: f.get("name"), confirmed, remotePreference: f.get("remotePreference") };
    } else {
      const confirmed: ProjectDraft = {
        kind: "PROJECT_DESCRIPTION",
        name: String(f.get("name") ?? "").trim() || null,
        startDate: String(f.get("startDate") ?? "").trim() || null,
        rateMaxYen: num("rateMaxYen"),
        // 週出社日数は在宅区分から自動導出（画面入力は在宅区分に一本化）
        onsiteDaysPerWeek: remoteLevelToOnsiteDays(String(f.get("remoteLevel"))),
        locationCity: String(f.get("locationCity") ?? "").trim() || null,
        noForeignNational: String(f.get("noForeignNational")) === "true",
        requiredSkills: list("requiredSkills"),
        preferredSkills: list("preferredSkills"),
        summary: String(f.get("summary") ?? ""),
      };
      // 在宅区分は抽出JSONの外で送る（週出社日数と重複する導出項目のため）
      body = { confirmed, remoteLevel: f.get("remoteLevel") };
    }

    const res = await fetch(`/api/v1/ingestions/${jobId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setLoading(false);
    if (res.ok) {
      const r = await res.json();
      router.push(r.kind === "ENGINEER_SHEET" ? `/engineers/${r.createdId}` : `/projects/${r.createdId}`);
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "確定に失敗しました");
    }
  }

  if (kind === "ENGINEER_SHEET") {
    const d = extracted as EngineerDraft;
    return (
      <form onSubmit={submit} className="mt-3 space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4">
        <p className="text-xs font-medium text-amber-800">
          抽出値を確認・修正して確定してください（確定すると人材が下書きで作成されます）
        </p>
        {error && <p className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          <div>
            <label className={label}>
              氏名{d.name ? "（書類から自動抽出・要確認）" : "（原本を参照して入力）"}
            </label>
            <input name="name" required defaultValue={d.name ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>所属区分</label>
            <select name="affiliationType" className={input} defaultValue={d.affiliationType ?? "AFFILIATED"}>
              {Object.entries(AFFILIATION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>国籍（国名。空欄は日本国籍とみなす）</label>
            <input name="nationality" defaultValue={d.nationality ?? ""} className={input} placeholder="例: 韓国" />
          </div>
          <div>
            <label className={label}>年代（5歳刻み下限）</label>
            <input type="number" name="ageBand" step={5} min={20} max={70} defaultValue={d.ageBand ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>居住エリア</label>
            <LocationInput name="residenceCity" initial={d.residenceCity} className={input} />
          </div>
          <div>
            <label className={label}>稼働可能日</label>
            <input type="date" name="availableFrom" defaultValue={d.availableFrom ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>希望単価（円/月）</label>
            <input type="number" name="desiredRateYen" defaultValue={d.desiredRateYen ?? ""} className={input} />
          </div>
          <div>
            <label className={label}>許容出社条件（原文の出社日数から自動判定）</label>
            <RemoteLevelSelect
              name="remotePreference"
              initial={d.maxOnsiteDaysPerWeek != null ? remoteLevelFromOnsiteDays(d.maxOnsiteDaysPerWeek) : "R0"}
              daysLabel="週最大出社日数"
              className={input}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={label}>工程（カンマ区切り）</label>
            <input name="processes" defaultValue={d.processes.join(", ")} className={input} />
          </div>
          <div className="sm:col-span-2">
            <label className={label}>役割（カンマ区切り: PM, PL 等）</label>
            <input name="roles" defaultValue={(d.roles ?? []).join(", ")} className={input} />
          </div>
          <div>
            <label className={label}>業種経験（カンマ区切り）</label>
            <input name="industries" defaultValue={(d.industries ?? []).join(", ")} className={input} />
          </div>
        </div>
        <div>
          <label className={label}>スキル（1行1件: 名称,分類,経験月数 — 不明は0）</label>
          {d.skills.some((s) => s.monthsEstimated) && (
            <p className="mb-1 rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
              ⚠ 経験月数が明記されていないため、経歴から推定した値が含まれます。確認して必要なら修正してください:{" "}
              {d.skills
                .filter((s) => s.monthsEstimated)
                .map((s) => `${s.name}（${s.months ?? "?"}ヶ月）`)
                .join("、")}
            </p>
          )}
          <textarea
            name="skills"
            rows={4}
            defaultValue={d.skills.map((s) => `${s.name},${s.category},${s.months ?? 0}`).join("\n")}
            className={`${input} font-mono`}
          />
        </div>
        <div>
          <label className={label}>匿名概要</label>
          <textarea name="summary" rows={2} defaultValue={d.summary} className={input} />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "確定中..." : "この内容で確定（人材を作成）"}
        </button>
      </form>
    );
  }

  const d = extracted as ProjectDraft;
  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4">
      <p className="text-xs font-medium text-amber-800">
        抽出値を確認・修正して確定してください（確定すると案件が下書きで作成されます）
      </p>
      {error && <p className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        <div className="sm:col-span-2 md:col-span-3">
          <label className={label}>案件名</label>
          <input name="name" defaultValue={d.name ?? ""} className={input} />
        </div>
        <div>
          <label className={label}>開始日</label>
          <input type="date" name="startDate" defaultValue={d.startDate ?? ""} className={input} />
        </div>
        <div>
          <label className={label}>単価上限（円/月）</label>
          <input type="number" name="rateMaxYen" defaultValue={d.rateMaxYen ?? ""} className={input} />
        </div>
        <div>
          <label className={label}>出社/在宅（原文の週出社日数から自動判定）</label>
          <RemoteLevelSelect
            name="remoteLevel"
            initial={d.onsiteDaysPerWeek != null ? remoteLevelFromOnsiteDays(d.onsiteDaysPerWeek) : "R0"}
            daysLabel="週出社日数"
            className={input}
          />
        </div>
        <div>
          <label className={label}>外国籍の受入</label>
          <select name="noForeignNational" className={input} defaultValue={d.noForeignNational ? "true" : "false"}>
            <option value="false">可</option>
            <option value="true">不可</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={label}>勤務地</label>
          <LocationInput name="locationCity" initial={d.locationCity} className={input} />
        </div>
        <div className="sm:col-span-2 md:col-span-3">
          <label className={label}>必須スキル（カンマ区切り）</label>
          <input name="requiredSkills" defaultValue={d.requiredSkills.join(", ")} className={input} />
        </div>
        <div className="sm:col-span-2 md:col-span-3">
          <label className={label}>尚可スキル（カンマ区切り）</label>
          <input name="preferredSkills" defaultValue={d.preferredSkills.join(", ")} className={input} />
        </div>
      </div>
      <div>
        <label className={label}>匿名概要（エンド企業名は抽象カテゴリ）</label>
        <textarea name="summary" rows={2} defaultValue={d.summary} className={input} />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "確定中..." : "この内容で確定（案件を作成）"}
      </button>
    </form>
  );
}
