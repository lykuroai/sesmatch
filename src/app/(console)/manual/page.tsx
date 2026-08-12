import { redirect } from "next/navigation";
import { getAuth } from "@/server/session-rsc";

// 操作マニュアル（企業コンソール利用者向け）。静的な説明ページ。
// 画面用語は統一ルールに準拠（商談／条件確認書／成約・稼働／成約手数料／〇マーク／自社表示）。

export const metadata = { title: "操作マニュアル" };

const TOC = [
  { id: "flow", label: "全体の流れ" },
  { id: "home", label: "ホーム" },
  { id: "projects", label: "案件" },
  { id: "engineers", label: "人材" },
  { id: "ingestions", label: "取込・取込履歴" },
  { id: "matching", label: "マッチング" },
  { id: "entries", label: "商談管理" },
  { id: "contracts", label: "成約・稼働" },
  { id: "billing", label: "成約手数料" },
  { id: "company", label: "会社マイページ" },
  { id: "glossary", label: "用語集" },
];

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h2 className="mb-3 border-b border-slate-100 pb-2 text-lg font-bold text-slate-800">
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

// 手順リスト（番号付き）
function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="ml-1 space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-slate-800 text-[11px] font-bold text-white">
            {i + 1}
          </span>
          <span>{it}</span>
        </li>
      ))}
    </ol>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
      {children}
    </p>
  );
}

export default async function ManualPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-2xl font-bold">操作マニュアル</h1>
      <p className="mb-6 text-sm text-slate-500">
        企業コンソールの使い方をメニューごとに説明します。用語は画面表示に合わせています。
      </p>

      {/* 目次 */}
      <nav className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="mb-2 text-xs font-bold text-slate-500">目次</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
          {TOC.map((t) => (
            <a key={t.id} href={`#${t.id}`} className="text-sky-700 hover:underline">
              {t.label}
            </a>
          ))}
        </div>
      </nav>

      <div className="space-y-5">
        <Section id="flow" title="全体の流れ">
          <p>
            本サービスは、案件情報と人材情報を登録・公開し、他社との双方向マッチングから商談・契約・稼働・手数料までを一貫して扱います。基本の流れは次のとおりです。
          </p>
          <div className="flex flex-col items-center gap-0 text-[13px] font-medium text-slate-600">
            {[
              "案件・人材を登録",
              "公開",
              "マッチング",
              "商談を申し込む",
              "商談開始（双方承認）",
              "面談・条件調整",
              "成約（条件確認書の相互締結）",
              "稼働開始",
              "月次確認・成約手数料",
            ].map((s, i, arr) => (
              <div key={s} className="flex flex-col items-center">
                <span className="w-64 rounded-lg border border-slate-200 bg-white px-4 py-2 text-center">
                  {s}
                </span>
                {i < arr.length - 1 && <span className="py-1 text-base leading-none text-slate-300">↓</span>}
              </div>
            ))}
          </div>
          <p>
            自社の情報は編集でき、他社の情報は開示レベルに応じた範囲のみ参照できます。相手の氏名・実額単価・企業名は、双方の承認（商談開始）が成立してから相互・同時に開示されます。
          </p>
        </Section>

        <Section id="home" title="ホーム">
          <p>
            ログイン後に最初に表示される画面です。公開中の案件・人材の数、推奨マッチ、承認待ちの商談申込み、面談予定、稼働中人数、今月の手数料、同意・証憑の期限、案件の鮮度警告など、対応が必要な項目をまとめて確認できます。
          </p>
        </Section>

        <Section id="projects" title="案件">
          <p>自社の案件を登録・編集・公開し、他社の公開案件を検索できます。</p>
          <Steps
            items={[
              <>「案件」→「新規登録」から、案件名・業種・必須/尚可スキル・工程・勤務地・在宅区分・単価・契約形態・受入所属区分などを入力します。</>,
              <>登録後、案件の詳細画面から「公開」にすると他社の検索・マッチング対象になります（公開前は自社のみ）。</>,
              <>内容を直すときは詳細画面の「編集」から。スキルは全置換で保存されます。</>,
            ]}
          />
          <p>
            一覧では必要スキル等でキーワード検索できます。表記ゆれは用語辞書で吸収されるため、「保険業務」で検索しても「保険」と登録された案件がヒットします。登録から7日以内の案件には <span className="rounded bg-rose-100 px-1 text-[11px] font-bold text-rose-600">NEW</span> が付きます。
          </p>
          <p>
            案件の進行状態（募集中／商談中／成約／終了）は、商談・契約の進行に連動して自動更新されますが、手動で上書きもできます。
          </p>
        </Section>

        <Section id="engineers" title="人材">
          <p>自社が管理する人材を登録・編集・公開し、他社の公開人材を検索できます。</p>
          <Steps
            items={[
              <>「人材」→「新規登録」から、年代・居住エリア・所属区分・スキル・工程・役割・単価・通勤/在宅条件などを入力します。氏名など個人情報は本人同意の管理対象です。</>,
              <>公開には有効な<b>本人同意</b>が必要です。同意がない、または所属証憑が期限切れの人材は公開できません。</>,
              <>職務経歴書（スキルシート）を添付すると、匿名化のうえ内容を抽出して登録に反映できます（下記「取込」参照）。</>,
            ]}
          />
          <p>
            人材の稼働状態（紹介中／商談中／成約／稼働中）は商談・契約・稼働に連動して自動更新され、手動でも変更できます。検索は案件と同様にキーワード・用語辞書に対応します。
          </p>
          <Note>
            性別・顔写真・民族は検索やマッチングの条件に使いません。国籍は案件の「外国籍不可」受入条件の判定にのみ使用します。
          </Note>
        </Section>

        <Section id="ingestions" title="取込・取込履歴">
          <p>
            メール・ファイル・画面貼り付けから案件票やスキルシートを取り込み、個人情報を匿名化したうえで内容を自動抽出します。
          </p>
          <Steps
            items={[
              <>ファイル（Excel/Word/PDF等）をアップロード、またはテキストを貼り付けて取込を開始します。</>,
              <>システムが個人情報を検出・匿名化し、匿名化済みテキストから項目を抽出します（氏名・連絡先などはそのまま外部に送りません）。</>,
              <>「取込履歴」で結果を開き、抽出値を人が確認・修正して確定します。確定した内容が案件・人材として登録されます。</>,
            ]}
          />
          <p>
            取込履歴の一覧では、各取込の状態（受領／匿名化中／抽出中／人手確認待ち／確定済み／失敗）を確認できます。
          </p>
        </Section>

        <Section id="matching" title="マッチング">
          <p>
            「案件→人材」「人材→案件」の双方向で候補を探せます。必須スキル・稼働開始日・単価上限・勤務地/出社条件・就労資格・商流などのハードフィルターで絞り込んだうえで、総合適合度を点数化して表示します。
          </p>
          <p>
            各候補では、適合した条件・不足している条件・確認事項・推薦理由が表示されます。適合条件には〇が付きます。候補から、そのまま商談を申し込めます。
          </p>
        </Section>

        <Section id="entries" title="商談管理">
          <p>
            商談（自社人材を他社案件へ提案／他社人材へ自社案件を提案）の送受信、承認、面談、メッセージ、条件調整をここで扱います。呼称は画面上「商談」で統一しています。
          </p>
          <Steps
            items={[
              <>候補の案件・人材から「<b>商談を申し込む</b>」で商談を開始します（自社人材を他社案件へ提案／他社人材へ自社案件を提案）。同一人材×同一案件の重複申込みはブロックされます。</>,
              <>相手が承認し、自社も承認すると「<b>商談開始</b>（双方承認）」が成立します。このとき初めて、氏名・実額単価・企業名がお互いに同時開示されます（Level 2）。</>,
              <>商談開始後は面談を調整し、メッセージでやり取りできます。条件が整えば「契約調整中」へ進めます。</>,
              <>取り下げる場合、商談開始前は「<b>商談申込みを取り消す</b>」、開始後は「<b>辞退する</b>」（受信側は「見送り」）を使います。</>,
            ]}
          />
          <p>
            一覧の商談ステータスは、申込み前／承認待ち（自社・相手側）／商談中／面談調整中／契約調整中／成約／見送り／辞退／保留 で表示されます。相手企業名は商談開始後に表示され、それまで自社側は「自社」と表示されます。
          </p>
          <Note>
            商談開始（双方承認）前のメッセージ・補足メモ・辞退理由には、メール・電話番号・SNS・URLなどの連絡先を含められません（プラットフォーム外での直接取引の誘導を防ぐため）。含まれる場合は保存されず、修正を求められます。
          </Note>
        </Section>

        <Section id="contracts" title="成約・稼働">
          <p>成約手続き（条件確認書）から稼働開始、月次確認、終了までを扱います。</p>
          <Steps
            items={[
              <>商談が契約調整中に進んだら「<b>条件確認書</b>」を作成します。作成時に指揮命令に関する確認事項（業務指示責任者・勤怠管理主体・配置決定主体・検収方法・再委託承認）の入力が必要です。</>,
              <>双方が〇（署名＝相互締結）すると<b>成約</b>となります。案件・人材の状態も自動で「成約」になります。</>,
              <>実際の稼働が始まったら「<b>稼働開始</b>」を登録します。これが手数料の起点になります。人材は「稼働中」になります。</>,
              <>需要側企業は毎月「月次確認」を行い、稼働実績を確定します。終了時は「終了」を登録します。</>,
            ]}
          />
          <Note>
            稼働開始前のキャンセルは手数料0円です。稼働開始後14日以内（境界含む）の離脱は、徴収済み手数料を全額返金します。
          </Note>
        </Section>

        <Section id="billing" title="成約手数料">
          <p>
            成約手数料は<b>需要側（案件保有）企業の負担</b>で、確定契約金額の<b>3%</b>（税抜。円未満切り捨て）です。実稼働開始から<b>最大12稼働月</b>まで発生し、13稼働月目以降は無料です。
          </p>
          <p>
            12か月の上限は、案件マスター×人材×需要側企業の組合せで累計し、契約を更新してもリセットされません。「成約手数料」画面で、月ごとの確定額・状態（課金／無料／キャンセル）を確認できます。
          </p>
        </Section>

        <Section id="company" title="会社マイページ（ヘッダー右の会社名から）">
          <p>企業に関する管理機能はヘッダー右の会社名から開く「会社マイページ」に集約されています。</p>
          <ul className="ml-4 list-disc space-y-1">
            <li><b>企業情報</b>: 企業名・事業者種別・法人番号の確認と修正</li>
            <li><b>担当者</b>: 担当者の招待・ロール変更・停止。招待・再招待で初期パスワードを発行します</li>
            <li><b>通報</b>: 再転載・無承認再仲介・直接取引誘引などの通報</li>
            <li><b>監査</b>: 自社の監査ログの閲覧</li>
            <li><b>プライバシー</b>: 本人からの訂正・削除請求の受付と処理</li>
            <li><b>企業間関係</b>: 取引先・一社下・営業委任の関係管理</li>
          </ul>
        </Section>

        <Section id="glossary" title="用語集">
          <dl className="space-y-2">
            {[
              ["開示レベル", "Level 1（検索・マッチング＝匿名情報のみ）／Level 2（商談開始＝氏名・実額単価・企業名を相互同時開示）／Level 3（契約締結）。"],
              ["商談開始（双方承認）", "商談を双方が承認した状態。ここで初めて相手の氏名・実額単価・企業名が開示されます。"],
              ["条件確認書", "個別の成約手続きに使う書面（プラットフォーム上の呼称）。双方の〇（署名）で相互締結＝成約。"],
              ["成約", "基本契約が有効で、条件確認書等の相互締結が完了した状態。"],
              ["稼働状態（人材）", "紹介中／商談中／成約／稼働中。商談・契約・稼働に連動して自動更新（手動上書き可）。"],
              ["進行状態（案件）", "募集中／商談中／成約／終了。同じく自動更新（手動上書き可）。"],
              ["商流・一社下", "人材流通は最大一社下（SUBTIER1）まで。二社下以降・無承認の再仲介・再転載は禁止です。"],
              ["自社表示", "一覧やLevel 2開示では、自社側の企業名は「自社」と表示し、相手企業名のみ実名で表示します。"],
            ].map(([term, desc]) => (
              <div key={term} className="grid grid-cols-[8rem_1fr] gap-2">
                <dt className="font-bold text-slate-800">{term}</dt>
                <dd className="text-slate-600">{desc}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>

      <p className="mt-6 text-center text-xs text-slate-400">
        画面や項目は改善のため変更されることがあります。ご不明な点は運営までお問い合わせください。
      </p>
    </div>
  );
}
