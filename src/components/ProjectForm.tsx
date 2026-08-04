"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AFFILIATION_LABELS, REMOTE_LEVEL_LABELS } from "@/lib/constants";

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
  onsiteDaysPerWeek: number;
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
  const isEdit = !!projectId;

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
        onsiteDaysPerWeek: parseInt(String(f.get("onsiteDaysPerWeek"))) || 0,
        remoteLevel: f.get("remoteLevel"),
        rateMaxYen: parseInt(String(f.get("rateMaxYen"))) * 10_000,
        contractType: f.get("contractType") || undefined,
        allowSubtier: f.get("allowSubtier") === "on",
        noForeignNational: f.get("noForeignNational") === "on",
        acceptedTypes,
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
          <label className={label}>契約形態</label>
          <select name="contractType" className={input} defaultValue={initial?.contractType ?? "準委任"}>
            <option value="準委任">準委任</option>
            <option value="請負">請負</option>
          </select>
        </div>
        <div>
          <label className={label}>週出社日数</label>
          <input type="number" name="onsiteDaysPerWeek" min={0} max={5} defaultValue={initial?.onsiteDaysPerWeek ?? 0} className={input} />
        </div>
        <div>
          <label className={label}>在宅区分</label>
          <select name="remoteLevel" className={input} defaultValue={initial?.remoteLevel ?? "R0"}>
            {Object.entries(REMOTE_LEVEL_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{k}: {v}</option>
            ))}
          </select>
        </div>
      </div>
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
