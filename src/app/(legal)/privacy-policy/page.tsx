// プライバシーポリシー（ドラフト）。【 】内は運営者が確定させる項目。公開前に弁護士等の確認を受けること
const h2 = "mt-8 mb-2 text-base font-bold text-slate-800";
const p = "mb-2 text-sm leading-relaxed text-slate-700";
const li = "mb-1 text-sm leading-relaxed text-slate-700";

export const metadata = { title: "プライバシーポリシー | SESマッチング" };

export default function PrivacyPage() {
  return (
    <article>
      <h1 className="text-xl font-bold text-slate-900">プライバシーポリシー</h1>
      <p className="mt-2 text-xs text-slate-400">制定日: 【制定日】／最終改定日: 【改定日】</p>
      <p className={p + " mt-4"}>
        【運営会社名】（以下「当社」といいます）は、SESマッチングプラットフォーム「SESマッチング」
        （以下「本サービス」といいます）における個人情報その他の情報の取扱いについて、
        以下のとおり定めます。
      </p>

      <h2 className={h2}>1. 事業者情報</h2>
      <p className={p}>
        事業者名: 【運営会社名】／所在地: 【所在地】／代表者: 【代表者名】／
        個人情報保護管理者: 【担当部署・役職】
      </p>

      <h2 className={h2}>2. 取得する情報</h2>
      <ol className="list-decimal pl-5">
        <li className={li}>
          企業担当者に関する情報: 氏名、メールアドレス、所属企業、役職・ロール、認証情報
        </li>
        <li className={li}>
          人材（技術者等）に関する情報: 氏名、年代、スキル・経歴、希望条件、最寄駅・市区町村、
          就労資格の確認状態、所属企業から提供されるスキルシート等の書類
        </li>
        <li className={li}>
          取引に関する情報: エントリー、メッセージ、面談、契約、稼働実績、請求に関する情報
        </li>
        <li className={li}>利用状況に関する情報: アクセスログ、操作ログ、Cookie等の識別子</li>
        <li className={li}>販促・案内の宛先情報: 企業名、担当者名、メールアドレス</li>
      </ol>

      <h2 className={h2}>3. 利用目的</h2>
      <ol className="list-decimal pl-5">
        <li className={li}>本サービスの提供（マッチング、エントリー、開示制御、契約・稼働・請求の管理）</li>
        <li className={li}>登録審査、本人確認、所属関係・就労資格の確認</li>
        <li className={li}>不正行為（再転載・無承認再仲介・直接取引の迂回等）の検知・調査・対応</li>
        <li className={li}>お知らせ・営業案内等のご連絡</li>
        <li className={li}>問い合わせ対応、監査記録の保全、法令に基づく対応</li>
        <li className={li}>個人・企業を特定できない形での統計作成およびサービス改善</li>
      </ol>

      <h2 className={h2}>4. 人材情報の段階開示</h2>
      <p className={p}>
        人材情報は、本人の有効な同意に基づき3段階で開示されます。検索・マッチング段階では氏名等を
        含まない匿名情報のみを表示し、取引当事者双方の承認が成立した時点で氏名・実額単価・企業名を
        相互かつ同時に開示します。片側の承認のみで開示されることはありません。有効な同意のない
        人材情報は公開されません。
      </p>

      <h2 className={h2}>5. LLM（大規模言語モデル）による処理</h2>
      <ol className="list-decimal pl-5">
        <li className={li}>
          当社は、書類の正規化・構造化のために外部のLLM APIを利用することがあります。
          送信するのは匿名化処理を施したテキストのみであり、氏名・生年月日・連絡先・住所番地・顔写真・
          企業実名・実額契約金額・健康/家族情報・国籍/在留証憑は送信しません。
        </li>
        <li className={li}>
          匿名化の置換対応表は分離して厳格に管理し、LLMには送信しません。
        </li>
        <li className={li}>採否・契約の判断をLLMのみで自動決定することはありません。</li>
      </ol>

      <h2 className={h2}>6. 第三者提供・委託</h2>
      <ol className="list-decimal pl-5">
        <li className={li}>
          当社は、本人の同意に基づく段階開示として取引相手方の利用企業に人材情報を提供する場合、
          および法令に基づく場合を除き、個人情報を第三者に提供しません。
        </li>
        <li className={li}>
          当社は、サービス運営に必要な範囲で、クラウドインフラ・メール配信等の事業者に個人情報の
          取扱いを委託することがあります（例: Amazon Web Services）。委託先には適切な監督を行います。
        </li>
      </ol>

      <h2 className={h2}>7. 保存期間</h2>
      <ol className="list-decimal pl-5">
        <li className={li}>氏名・連絡先・詳細スキルシート・取込原本: 最終更新から2年</li>
        <li className={li}>契約・請求に関する情報: 個人特定情報を除去・仮名化のうえ法令に基づく必要期間</li>
        <li className={li}>統計情報: 個人を特定できない形で保存</li>
        <li className={li}>削除の記録: 個人情報を含めない形で保存</li>
      </ol>

      <h2 className={h2}>8. 本人の権利（開示・訂正・削除等）</h2>
      <ol className="list-decimal pl-5">
        <li className={li}>
          本人は、当社所定の窓口を通じて、自己の個人情報の開示・訂正・利用停止・削除を請求できます。
        </li>
        <li className={li}>
          削除請求を受け付けた場合、当社は対象情報を直ちに非公開とし、14日以内に処理を判断のうえ、
          論理削除の30日後に物理削除を行い、バックアップについても90日以内に失効させます。
          係争中・未払い等の正当な保存事由がある情報は、法令の範囲で隔離保管します。
        </li>
      </ol>

      <h2 className={h2}>9. 安全管理措置</h2>
      <p className={p}>
        当社は、個人情報への不正アクセス、漏えい、滅失または毀損を防止するため、通信の暗号化、
        アクセス権限の管理（テナント分離・ロール制御）、監査ログの記録、匿名化処理その他の
        安全管理措置を講じます。
      </p>

      <h2 className={h2}>10. Cookie等の利用</h2>
      <p className={p}>
        本サービスは、ログイン状態の維持等のためにCookieおよび類似技術を利用します。
        これらは本サービスの提供に必要な範囲でのみ利用します。
      </p>

      <h2 className={h2}>11. 改定</h2>
      <p className={p}>
        当社は、法令の改正やサービス内容の変更に応じて本ポリシーを改定することがあります。
        重要な変更は本サービス上での掲示その他適切な方法で周知します。
      </p>

      <h2 className={h2}>12. お問い合わせ窓口</h2>
      <p className={p}>
        個人情報の取扱いに関するお問い合わせ・各種請求は、以下の窓口までご連絡ください。
        <br />
        【窓口メールアドレス】／【受付時間等】
      </p>
    </article>
  );
}
