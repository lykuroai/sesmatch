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
      const from = p.term.trim();
      const to = p.canonical.trim();
      // 表記が完全一致（すでに正規形そのもの）の場合のみ登録不要。
      // 大文字小文字・接尾辞ゆれ（JAva→Java、保険業務→保険）は正規化でも吸収されるが、
      // 運営コンソールの用語辞書で見える・是正できるように辞書にも登録する
      if (!from || !to || from === to) continue;
      await prisma.skillAlias
        .create({
          data: { alias: from, canonical: to, source: "LLM" },
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
