"use client";

import { useState } from "react";
import { RemoteLevelSelect } from "./RemoteLevelSelect";
import { useRouter } from "next/navigation";
import {
  AFFILIATION_LABELS,
  DISPATCH_CONTRACT_TYPE,
  PROJECT_CONTRACT_TYPES,
} from "@/lib/constants";

const input = "w-full rounded border border-slate-300 px-3 py-2 text-sm";
const label = "mb-1 block text-sm font-medium";

export type ProjectFormInitial = {
  name: string;
  anonymousSummary: string;
  industry?: string | null;
  headcount: number;
  startDate: string; // YYYY-MM-DD
  locationCity?: string | null;
  contractType?: string | null;
  dispatchConflictDate?: string | null; // YYYY-MM-DD
  dispatchDemandManager?: string | null;
  dispatchProhibitedConfirmed?: boolean;
  remoteLevel: string;
  rateMaxMan: number; // 万円
  requiredSkills: string[];
  preferredSkills: string[];
  processes: string[];
  acceptedTypes: string[];
  allowSubtier: boolean;
  noForeignNational?: boolean;
};

export function ProjectForm({
  projectId,
  initial,
}: {
  projectId?: string; // 指定時は編集モード（PUT）
  initial?: ProjectFormInitial;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [contractType, setContractType] = useState(initial?.contractType ?? "準委任");
  const isEdit = !!projectId;
  const isDispatch = contractType === DISPATCH_CONTRACT_TYPE;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const parseList = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);
    const acceptedTypes = ["EMPLOYEE", "AFFILIATED", "FREELANCER", "SUBTIER1"].filter(
      (t) => f.get(`accept_${t}`) === "on"
    );

    const res = await fetch(isEdit ? `/api/v1/projects/${projectId}` : "/api/v1/projects", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.get("name"),
        anonymousSummary: f.get("anonymousSummary"),
        industry: f.get("industry") || undefined,
        headcount: parseInt(String(f.get("headcount"))) || 1,
        startDate: f.get("startDate"),
        locationCity: f.get("locationCity") || undefined,
        // 週出社日数は在宅区分から自動導出（サーバー側で連動）
        remoteLevel: f.get("remoteLevel"),
        rateMaxYen: parseInt(String(f.get("rateMaxYen"))) * 10_000,
        contractType,
        // 労働者派遣（基本契約第4条）: 追加項目を送信。一社下不可・自社社員のみはサーバー側でも強制される
        dispatchConflictDate: isDispatch ? f.get("dispatchConflictDate") || undefined : undefined,
        dispatchDemandManager: isDispatch ? f.get("dispatchDemandManager") || undefined : undefined,
        dispatchProhibitedConfirmed: isDispatch
          ? f.get("dispatchProhibitedConfirmed") === "on"
          : undefined,
        allowSubtier: !isDispatch && f.get("allowSubtier") === "on",
        noForeignNational: f.get("noForeignNational") === "on",
        acceptedTypes: isDispatch ? ["EMPLOYEE"] : acceptedTypes,
        processes: parseList(String(f.get("processes") ?? "")),
        requiredSkills: parseList(String(f.get("requiredSkills") ?? "")).map((name) => ({ name })),
        preferredSkills: parseList(String(f.get("preferredSkills") ?? "")).map((name) => ({ name })),
      }),
    });
    setLoading(false);
    if (res.ok) {
      const saved = await res.json();
      router.push(`/projects/${saved.id}`);
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "保存に失敗しました");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div>
        <label className={label}>案件名</label>
        <input name="name" required defaultValue={initial?.name ?? ""} className={input} />
      </div>
      <div>
        <label className={label}>匿名概要（エンド企業名は「大手金融機関」等の抽象カテゴリで記載）</label>
        <textarea name="anonymousSummary" rows={3} required defaultValue={initial?.anonymousSummary ?? ""} className={input} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>業種</label>
          <input name="industry" defaultValue={initial?.industry ?? ""} className={input} placeholder="金融" />
        </div>
        <div>
          <label className={label}>募集人数</label>
          <input type="number" name="headcount" defaultValue={initial?.headcount ?? 1} min={1} className={input} />
        </div>
        <div>
          <label className={label}>開始日</label>
          <input type="date" name="startDate" required defaultValue={initial?.startDate ?? ""} className={input} />
        </div>
        <div>
          <label className={label}>単価上限（万円/月）</label>
          <input type="number" name="rateMaxYen" required min={10} defaultValue={initial?.rateMaxMan ?? ""} className={input} placeholder="80" />
        </div>
        <div>
          <label className={label}>勤務地（市区町村）</label>
          <input name="locationCity" defaultValue={initial?.locationCity ?? ""} className={input} placeholder="千代田区" />
        </div>
        <div>
          <label className={label}>契約形態（必須）</label>
          <select
            name="contractType"
            required
            className={input}
            value={contractType}
            onChange={(e) => setContractType(e.target.value)}
          >
            {PROJECT_CONTRACT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>在宅区分</label>
          <RemoteLevelSelect
            name="remoteLevel"
            initial={initial?.remoteLevel ?? "R0"}
            daysLabel="週出社日数"
            showCode
            className={input}
          />
        </div>
      </div>
      {isDispatch && (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-bold text-amber-900">労働者派遣の確認事項（基本契約第4条）</p>
          <p className="text-xs text-amber-800">
            労働者派遣では、供給側企業が直接雇用する人材（自社社員）のみ提案可能・一社下不可が
            自動適用されます。提案時に供給側企業の労働者派遣事業許可（許可番号・有効期限・派遣元責任者）を
            自動チェックします。
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>抵触日（事業所単位）</label>
              <input
                type="date"
                name="dispatchConflictDate"
                required
                defaultValue={initial?.dispatchConflictDate ?? ""}
                className={input}
              />
            </div>
            <div>
              <label className={label}>派遣先責任者</label>
              <input
                name="dispatchDemandManager"
                required
                defaultValue={initial?.dispatchDemandManager ?? ""}
                className={input}
                placeholder="例: 開発部長 ○○"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-amber-900">
            <input
              type="checkbox"
              name="dispatchProhibitedConfirmed"
              required
              defaultChecked={initial?.dispatchProhibitedConfirmed ?? false}
            />
            派遣禁止業務（港湾運送・建設・警備・医療関係等）に該当しないことを確認しました
          </label>
        </div>
      )}
      <div>
        <label className={label}>必須スキル（カンマ区切り）</label>
        <input name="requiredSkills" defaultValue={initial?.requiredSkills.join(", ") ?? ""} className={input} placeholder="Java, Spring Boot" />
      </div>
      <div>
        <label className={label}>尚可スキル（カンマ区切り）</label>
        <input name="preferredSkills" defaultValue={initial?.preferredSkills.join(", ") ?? ""} className={input} placeholder="AWS, Docker" />
      </div>
      <div>
        <label className={label}>工程（カンマ区切り）</label>
        <input name="processes" defaultValue={initial?.processes.join(", ") ?? ""} className={input} placeholder="基本設計, 開発" />
      </div>
      {isDispatch ? (
        <p className="text-xs text-slate-500">
          受入所属区分: 自社社員（直接雇用）のみ／一社下不可（労働者派遣のため自動適用）
        </p>
      ) : (
        <>
          <div>
            <p className={label}>受入所属区分</p>
            <div className="flex gap-4 text-sm">
              {Object.entries(AFFILIATION_LABELS).map(([k, v]) => (
                <label key={k} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    name={`accept_${k}`}
                    defaultChecked={initial ? initial.acceptedTypes.includes(k) : k !== "SUBTIER1"}
                  />
                  {v}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="allowSubtier" defaultChecked={initial?.allowSubtier ?? false} />
            一社下可（最大商流1）
          </label>
        </>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="noForeignNational"
          defaultChecked={initial?.noForeignNational ?? false}
        />
        外国籍不可（外国籍の人材をマッチング対象外にする）
      </label>
      <button
        type="submit"
        disabled={loading}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "保存中..." : isEdit ? "更新する" : "登録する"}
      </button>
    </form>
  );
}
