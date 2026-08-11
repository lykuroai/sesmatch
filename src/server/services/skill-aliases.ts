// 用語辞書の自動増補（Phase 2 名寄せ）
// 取込で現れた新語（辞書・既存正規形にない語）の正規形をLLMに提案させ、
// 承認不要で辞書に登録する（source=LLM・即利用可）。登録済み分は運営コンソールの
// 「用語辞書」で修正・削除できる。失敗しても取込処理は失敗させない。

import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { getLlmGateway } from "@/server/pipeline/llm";
import { normalizeSkillTerm } from "@/lib/constants";

export async function registerNewTermAliases(terms: string[], tenantCompanyId: string) {
  try {
    const uniq = [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
    if (uniq.length === 0) return;

    const aliases = await prisma.skillAlias.findMany();
    const known = new Set<string>();
    for (const a of aliases) {
      known.add(normalizeSkillTerm(a.alias));
      known.add(normalizeSkillTerm(a.canonical));
    }
    const newTerms = uniq.filter((t) => !known.has(normalizeSkillTerm(t)));
    if (newTerms.length === 0) return;

    const canonicals = [...new Set(aliases.map((a) => a.canonical))];
    const proposals = await getLlmGateway().proposeCanonicalTerms(newTerms, canonicals);

    const added: string[] = [];
    for (const p of proposals) {
      const from = normalizeSkillTerm(p.term);
      const to = normalizeSkillTerm(p.canonical);
      // 正規形が用語と同じ（接尾辞正規化で吸収できる範囲）なら辞書エントリ不要
      if (!from || !to || from === to) continue;
      await prisma.skillAlias
        .create({
          data: { alias: p.term.trim(), canonical: p.canonical.trim(), source: "LLM" },
        })
        .then(() => added.push(`${p.term}→${p.canonical}`))
        .catch(() => null); // 並行登録による重複は無視
    }
    if (added.length > 0) {
      await audit({
        tenantCompanyId,
        action: "SkillAliasAutoRegistered",
        targetType: "SkillAlias",
        targetId: "auto",
        metadata: { added },
      });
    }
  } catch (e) {
    // 辞書増補の失敗は取込を失敗させない（次回の取込で再挑戦される）
    console.error("[alias] 用語辞書の自動増補に失敗", e);
  }
}
