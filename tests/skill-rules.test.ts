import { describe, expect, it } from "vitest";
import { demoteLearnableSkills } from "../src/server/pipeline/skill-rules";

const SAMPLE = `案件:
     ゲノム系 小規模向け環境払い出し機能構築に向けた各システム作成

【必須】
　　■Java/Javascript
　　■Front:React or Vue(予定-React)
　　■Fw :Spring Boot、AWSを使って開発

【取得技術】
　　■TDD、AIでの開発構築
　　■AWSのRes及び他サービスの技術力
　　※上記技術においては稼働内で2w前後の勉強期間があります

【勤務地】　基本－高田馬場or新川
【募集】 ２名
`;

describe("demoteLearnableSkills", () => {
  it("取得技術ブロックに現れる技術は必須から尚可へ移す", () => {
    const r = demoteLearnableSkills(
      SAMPLE,
      ["Java", "JavaScript", "React", "Spring Boot", "AWS"],
      ["Vue.js"]
    );
    expect(r.requiredSkills).toEqual(["Java", "JavaScript", "React", "Spring Boot"]);
    expect(r.preferredSkills).toContain("AWS");
  });

  it("尚可に既にある技術は重複追加しない", () => {
    const r = demoteLearnableSkills(SAMPLE, ["AWS"], ["aws"]);
    expect(r.requiredSkills).toEqual([]);
    expect(r.preferredSkills).toEqual(["aws"]);
  });

  it("習得予定の記述がなければ変更しない", () => {
    const text = "【必須】\n・AWS構築経験3年\n【尚可】\n・Terraform";
    const r = demoteLearnableSkills(text, ["AWS"], ["Terraform"]);
    expect(r.requiredSkills).toEqual(["AWS"]);
  });

  it("ブロック外でも「勉強期間」等を含む行の技術は移す", () => {
    const text = "【必須】\n・Java\n・Kubernetes（稼働内で勉強期間があります）";
    const r = demoteLearnableSkills(text, ["Java", "Kubernetes"], []);
    expect(r.requiredSkills).toEqual(["Java"]);
    expect(r.preferredSkills).toEqual(["Kubernetes"]);
  });
});
