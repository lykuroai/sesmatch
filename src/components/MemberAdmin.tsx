"use client";

// 担当者招待・ロール変更・停止（§7）
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS } from "@/lib/constants";

const ASSIGNABLE = Object.keys(ROLE_LABELS).filter((r) => r !== "OWNER");

export function InviteMemberForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const f = new FormData(form);
    const roles = ASSIGNABLE.filter((r) => f.get(`role_${r}`) === "on");
    const email = String(f.get("email"));
    const res = await fetch("/api/v1/company/members/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name: f.get("name"), roles }),
    });
    if (res.ok) {
      const body = await res.json();
      setIssued({ email, password: body.initialPassword });
      form.reset();
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "招待に失敗しました");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-sm">
      {error && <p className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      {issued && (
        <p className="rounded bg-emerald-50 p-2 text-xs text-emerald-800">
          招待しました。初期パスワード（この画面でのみ表示）: <b>{issued.email}</b> /{" "}
          <code className="rounded bg-white px-1">{issued.password}</code>
        </p>
      )}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs text-slate-500">氏名</label>
          <input name="name" required className="w-full rounded border border-slate-300 px-2 py-1.5" />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs text-slate-500">メールアドレス</label>
          <input type="email" name="email" required className="w-full rounded border border-slate-300 px-2 py-1.5" />
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs text-slate-500">ロール（複数可）</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {ASSIGNABLE.map((r) => (
            <label key={r} className="flex items-center gap-1 text-xs">
              <input type="checkbox" name={`role_${r}`} />
              {ROLE_LABELS[r]}
            </label>
          ))}
        </div>
      </div>
      <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700">
        招待する
      </button>
    </form>
  );
}

export function MemberRow({
  member,
}: {
  member: { id: string; name: string; email: string; roles: string[]; status: string; isOwner: boolean };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email);
  const [selected, setSelected] = useState<string[]>(member.roles);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<string | null>(null); // 再招待で発行した初期パスワード

  async function save() {
    setError(null);
    const res = await fetch(`/api/v1/company/members/${member.id}/roles`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roles: selected }),
    });
    if (res.ok) {
      setEditing(false);
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "更新に失敗しました");
    }
  }

  async function saveProfile() {
    setError(null);
    const res = await fetch(`/api/v1/company/members/${member.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email }),
    });
    if (res.ok) {
      setEditingProfile(false);
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "更新に失敗しました");
    }
  }

  async function suspend() {
    if (!window.confirm(`${member.name} を停止しますか？（全セッションが失効します）`)) return;
    const res = await fetch(`/api/v1/company/members/${member.id}/suspend`, { method: "POST" });
    if (res.ok) router.refresh();
  }

  async function reinvite() {
    if (
      !window.confirm(
        `${member.name} に招待メールを再送しますか？（初期パスワードが再発行され、以前のパスワード・セッションは無効になります）`
      )
    )
      return;
    setError(null);
    const res = await fetch(`/api/v1/company/members/${member.id}/reinvite`, { method: "POST" });
    if (res.ok) {
      const b = await res.json();
      setIssued(b.initialPassword);
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "再招待に失敗しました");
    }
  }

  async function remove() {
    if (!window.confirm(`${member.name} を削除しますか？（アカウントごと削除され、元に戻せません）`)) return;
    setError(null);
    const res = await fetch(`/api/v1/company/members/${member.id}`, { method: "DELETE" });
    if (res.ok) {
      router.refresh();
    } else {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "削除に失敗しました");
    }
  }

  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-3 font-medium">
        {editingProfile ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1"
          />
        ) : (
          member.name
        )}
      </td>
      <td className="px-4 py-3">
        {editingProfile ? (
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1"
          />
        ) : (
          <>
            {member.email}
            {issued && (
              <p className="mt-1 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                再招待しました。初期パスワード（この画面でのみ表示）:{" "}
                <code className="rounded bg-white px-1">{issued}</code>
              </p>
            )}
          </>
        )}
      </td>
      <td className="px-4 py-3">
        {editing ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {ASSIGNABLE.map((r) => (
              <label key={r} className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={selected.includes(r)}
                  onChange={(e) =>
                    setSelected(e.target.checked ? [...selected, r] : selected.filter((x) => x !== r))
                  }
                />
                {ROLE_LABELS[r]}
              </label>
            ))}
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {member.roles.map((r) => (
              <span key={r} className="rounded bg-slate-100 px-2 py-0.5 text-xs">
                {ROLE_LABELS[r]}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-4 py-3">{member.status === "ACTIVE" ? "有効" : member.status === "RETIRED" ? "停止" : member.status}</td>
      <td className="px-4 py-3 text-right text-xs">
        {!member.isOwner && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {error && !editing && <span className="text-red-600">{error}</span>}
            {editingProfile ? (
              <>
                <button onClick={saveProfile} className="rounded bg-blue-600 px-2 py-1 text-white">保存</button>
                <button
                  onClick={() => {
                    setEditingProfile(false);
                    setName(member.name);
                    setEmail(member.email);
                  }}
                  className="rounded border border-slate-300 px-2 py-1"
                >
                  取消
                </button>
              </>
            ) : editing ? (
              <>
                <button onClick={save} className="rounded bg-blue-600 px-2 py-1 text-white">保存</button>
                <button onClick={() => setEditing(false)} className="rounded border border-slate-300 px-2 py-1">
                  取消
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setEditingProfile(true)}
                  className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                >
                  編集
                </button>
                <button onClick={() => setEditing(true)} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
                  ロール変更
                </button>
                <button onClick={reinvite} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
                  再招待
                </button>
                {member.status === "ACTIVE" && (
                  <button onClick={suspend} className="rounded border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50">
                    停止
                  </button>
                )}
                <button onClick={remove} className="rounded border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50">
                  削除
                </button>
              </>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
