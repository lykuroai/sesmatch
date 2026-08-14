// 監査ログ表示用の日本語ラベル（§31）。記録側は英語のアクション名のまま変更しない。

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  // 認証
  LoginSucceeded: "ログイン成功",
  LoginFailed: "ログイン失敗",
  // 企業・メンバー
  CompanyApplied: "企業登録を申請",
  CompanyApproved: "企業を承認",
  CompanyImported: "企業を取込登録",
  CompanyImportMemberAdded: "取込企業にメンバー追加",
  CompanyUpdatedByOperations: "運営が企業情報を更新",
  CompanyDeletedByOperations: "運営が企業を削除",
  MemberInvited: "メンバーを招待",
  MemberReinvited: "メンバーを再招待",
  MemberReinvitedByOperations: "運営がメンバーを再招待",
  MemberRolesUpdated: "メンバーのロールを変更",
  MemberProfileUpdated: "メンバー情報を更新",
  MemberProfileUpdatedByOperations: "運営がメンバー情報を更新",
  MemberPromotedToOwnerByOperations: "運営がオーナーへ昇格",
  MemberSuspended: "メンバーを停止",
  MemberDeleted: "メンバーを削除",
  MemberDeletedByOperations: "運営がメンバーを削除",
  RelationshipRegistered: "企業間関係を登録",
  // 案件・人材
  ProjectCreated: "案件を作成",
  ProjectUpdated: "案件を更新",
  ProjectDeleted: "案件を削除",
  ProjectRouteOpened: "案件ルートを開設",
  ProjectUnpublished: "案件を非公開化",
  EngineerUnpublished: "人材を非公開化",
  EngineerCreated: "人材を登録",
  EngineerUpdated: "人材を更新",
  EngineerDeleted: "人材を削除",
  EngineerPublished: "人材を公開",
  ConsentRegistered: "本人同意を登録",
  // 取込パイプライン
  DocumentReceived: "書類を受領",
  PiiMasked: "個人情報を匿名化",
  LlmRequest: "LLMへ抽出依頼",
  ExtractionCompleted: "自動抽出が完了",
  IngestionConfirmed: "取込内容を確定",
  // マッチング・エントリー
  MatchCalculated: "マッチングを実行",
  EntrySubmitted: "エントリーを提出",
  EntryApproved: "エントリーを承認（片側）",
  MutualApprovalCompleted: "双方承認が成立",
  EntryDeclined: "エントリーを辞退",
  EntryWithdrawn: "エントリーを取下げ",
  ContactInfoBlocked: "連絡先を含むメッセージを拒否",
  InterviewConfirmed: "面談を確定",
  EntryMovedToConditions: "条件調整へ移行",
  // 契約・稼働・請求
  ContractCreated: "契約を作成",
  ContractSigned: "契約に署名（片側）",
  ContractExecuted: "契約が締結（成約）",
  ContractCancelled: "契約をキャンセル",
  ContractTerminated: "契約を終了",
  WorkStarted: "稼働を開始",
  WorkMonthConfirmed: "月次稼働を確認",
  FeeCalculated: "手数料を計算",
  FeeRefunded: "手数料を返金",
  InvoiceIssued: "請求書を発行",
  InvoicePaid: "請求書を入金済みに更新",
  // 通報・削除請求・運営
  ReportSubmitted: "通報を送信",
  ReportStatusUpdated: "通報の対応状況を更新",
  InquirySubmitted: "お問合せを送信",
  InquiryStatusUpdated: "お問合せの対応状況を更新",
  PrivacyRequestReceived: "本人削除請求を受付",
  PrivacyRequestApproved: "削除請求を承認",
  PrivacyRequestRejected: "削除請求を却下",
  DeletionExecuted: "物理削除を実行",
  ProspectsImported: "見込み企業を取込",
  ProspectDeleted: "見込み企業を削除",
  OperationsBroadcastMailSent: "運営から一斉メール送信",
};

export const AUDIT_TARGET_LABELS: Record<string, string> = {
  Company: "企業",
  CompanyMember: "メンバー",
  CompanyRelationship: "企業間関係",
  Contract: "契約",
  Engineer: "人材",
  Entry: "エントリー",
  IngestionJob: "取込ジョブ",
  Invoice: "請求書",
  PlatformFee: "手数料",
  PrivacyRequest: "削除請求",
  Project: "案件",
  ProspectContact: "見込み企業",
  Report: "通報",
  SourceDocument: "原本書類",
};

export const AUDIT_METADATA_LABELS: Record<string, string> = {
  type: "種別",
  kind: "種別",
  kinds: "検出種別",
  side: "承認側",
  projectId: "案件ID",
  engineerId: "人材ID",
  interviewId: "面談ID",
  consentId: "同意ID",
  createdId: "作成ID",
  filename: "ファイル名",
  tokenCount: "匿名化トークン数",
  provider: "LLM事業者",
  baseUrl: "接続先",
  model: "モデル",
  purpose: "目的",
  inputTokens: "入力トークン",
  outputTokens: "出力トークン",
  month: "対象月",
  fee: "手数料",
  feeCount: "手数料件数",
  totalYen: "合計（円）",
  refund: "返金",
  refundedFees: "返金件数",
  reason: "理由",
  roles: "ロール",
  email: "メールアドレス",
  emailChanged: "メール変更",
  status: "ステータス",
  workflowStatus: "進行状態",
  workStatus: "稼働状態",
  category: "カテゴリ",
  companyType: "企業種別",
  direction: "方向",
  candidates: "候補数",
  invited: "招待数",
  row: "行",
  rows: "行数",
  created: "作成数",
};

const AUDIT_VALUE_LABELS: Record<string, string> = {
  SUPPLY: "供給側",
  DEMAND: "需要側",
  RECRUITING: "募集中",
  CONTRACTED: "成約",
  ENDED: "終了",
  PROPOSING: "紹介中",
  WORKING: "稼働中",
  ENGINEER_TO_PROJECTS: "人材→案件",
  PROJECT_TO_ENGINEERS: "案件→人材",
  true: "あり",
  false: "なし",
};

// metadata の1項目を「ラベル: 値」の文字列に整形する
export function formatAuditMetadata(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  return Object.entries(metadata as Record<string, unknown>).map(([key, value]) => {
    const label = AUDIT_METADATA_LABELS[key] ?? key;
    let text: string;
    if (Array.isArray(value)) {
      text = value.map((v) => AUDIT_VALUE_LABELS[String(v)] ?? String(v)).join("、");
    } else if (value === null || value === undefined) {
      text = "-";
    } else {
      text = AUDIT_VALUE_LABELS[String(value)] ?? String(value);
    }
    return `${label}: ${text}`;
  });
}
