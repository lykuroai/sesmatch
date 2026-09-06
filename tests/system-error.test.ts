import { describe, expect, it } from "vitest";
import {
  NOTIFY_SUPPRESS_MS,
  buildNotificationMail,
  ingestionErrorSource,
  isUserSideIngestionError,
  shouldNotify,
  truncate,
} from "../src/server/system-error/logic";

describe("システムエラー通知の判定", () => {
  const now = new Date("2026-09-06T10:00:00Z");

  it("初回・抑制時間経過後は通知する", () => {
    expect(shouldNotify(null, now)).toBe(true);
    expect(shouldNotify(new Date(now.getTime() - NOTIFY_SUPPRESS_MS), now)).toBe(true);
    expect(shouldNotify(new Date(now.getTime() - NOTIFY_SUPPRESS_MS - 1), now)).toBe(true);
  });

  it("同一内容は30分以内は再通知しない", () => {
    expect(shouldNotify(new Date(now.getTime() - 1000), now)).toBe(false);
    expect(shouldNotify(new Date(now.getTime() - NOTIFY_SUPPRESS_MS + 1), now)).toBe(false);
  });
});

describe("取込失敗の分類", () => {
  it("書類側の問題は運営へ通知しない", () => {
    expect(isUserSideIngestionError("KIND_MISMATCH: この書類は人材と判定されました。")).toBe(true);
    expect(isUserSideIngestionError("文書種別を判定できませんでした")).toBe(true);
    expect(isUserSideIngestionError("PDF からテキストを抽出できませんでした（OCRでも文字を検出できません）")).toBe(true);
    expect(isUserSideIngestionError("Word（.doc）からテキストを抽出できませんでした。.docx か PDF に変換してください")).toBe(true);
  });

  it("LLM 障害・環境不備はシステムエラーとして通知する", () => {
    expect(isUserSideIngestionError("LLM API エラー: HTTP 502")).toBe(false);
    expect(isUserSideIngestionError("LLM API への接続に失敗しました: fetch failed")).toBe(false);
    expect(isUserSideIngestionError("LLM抽出結果のJSON検証に失敗しました（name: Required）")).toBe(false);
    expect(isUserSideIngestionError("LLM出力が空です")).toBe(false);
    expect(isUserSideIngestionError("OCR環境（tesseract）が未設定のため、画像の取込ができません")).toBe(false);
  });

  it("LLM 由来かどうかで分類を分ける", () => {
    expect(ingestionErrorSource("LLM API エラー: HTTP 502")).toBe("LLM");
    expect(ingestionErrorSource("OCR環境（tesseract）が未設定のため、画像の取込ができません")).toBe("INGEST");
  });
});

describe("通知メール", () => {
  it("件名・本文に分類・内容・コンソールURLを含み、詳細は切り詰める", () => {
    const mail = buildNotificationMail({
      source: "LLM",
      message: "LLM API エラー: HTTP 502",
      detail: "x".repeat(3000),
      tenantCompanyName: "A社",
      targetType: "IngestionJob",
      targetId: "job1",
      occurredAt: new Date("2026-09-06T10:00:00Z"),
      adminUrl: "https://ses.lykuro.ai/admin#errors",
    });
    expect(mail.subject).toContain("システムエラー（LLM）");
    expect(mail.subject).toContain("HTTP 502");
    expect(mail.body).toContain("企業: A社");
    expect(mail.body).toContain("対象: IngestionJob job1");
    expect(mail.body).toContain("https://ses.lykuro.ai/admin#errors");
    expect(mail.body.length).toBeLessThan(2000);
  });

  it("truncate は上限を超える文字列だけ切り詰める", () => {
    expect(truncate("abc", 5)).toBe("abc");
    expect(truncate("abcdef", 5)).toBe("abcd…");
    expect(truncate(undefined, 5)).toBeUndefined();
  });
});
