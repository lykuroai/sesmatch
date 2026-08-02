"use client";

// 企業情報の修正（企業オーナー・企業管理者）
import { useState } from "react";
import { useRouter } from "next/navigation";

export function CompanyProfileForm({
  company,
}: {
  company: { name: string; companyType: string; corporateNumber: string | null };
}) {
  const router = useRouter();
  const [name, setName] = useState(company.name);
  const [companyType, setCompanyType] = useState(company.companyType);
  const [corporateNumber, setCorporateNumber] = useState(company.corporateNumber ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const res = await fetch("/api/v1/company/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, companyType, corporateNumber }),
    });
    if (res.ok) {
      setSaved(true);
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "保存に失敗しました");
    }
  }

  return (
    <form onSubmit={submit} className="max-w-lg space-y-3 text-sm">
      {error && <p className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      {saved && <p className="rounded bg-emerald-50 p-2 text-xs text-emerald-800">保存しました</p>}
      <div>
        <label className="mb-1 block text-xs text-slate-500">企業名</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full rounded border border-slate-300 px-2 py-1.5"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">事業者種別</label>
        <select
          value={companyType}
          onChange={(e) => setCompanyType(e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1.5"
        >
          <option value="CORPORATION">法人</option>
          <option value="SOLE_PROPRIETOR">個人事業主</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">
          法人番号（13桁・法人は必須）
        </label>
        <input
          value={corporateNumber}
          onChange={(e) => setCorporateNumber(e.target.value)}
          placeholder="1234567890123"
          className="w-full rounded border border-slate-300 px-2 py-1.5"
        />
      </div>
      <button
        type="submit"
        className="rounded bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-700"
      >
        保存
      </button>
    </form>
  );
}
