import Link from "next/link";

export const metadata = { title: "サービス紹介 | SES DirectMatch" };

// サービス紹介ドキュメント（営業資料の公開版）: SES DirectMatch + SES-Connector
// 未ログインで閲覧可能。(legal) レイアウト（白カード・max-w-3xl）で表示される

const PAINS = [
  {
    title: "商談先がいつもの取引先だけ",
    body: "案件も人材も、既存の付き合いの中でしか探せない。埋まらない案件・待機人材が発生する。",
  },
  {
    title: "書類整理がぜんぶ手作業",
    body: "日々届く案件票・スキルシートの転記と整理に時間を取られ、営業に使う時間が削られる。",
  },
  {
    title: "個人情報を出すのが怖い",
    body: "スキルシートの共有は情報漏えいと隣り合わせ。どこまで開示してよいか毎回悩む。",
  },
];

const JOURNEY = [
  { title: "取込", body: "書類をAIが自動で項目化" },
  { title: "マッチング", body: "案件⇄人材の双方向で候補を提示" },
  { title: "商談", body: "人材提案・案件紹介を申込み" },
  { title: "双方承認", body: "承認して初めて実名を相互開示" },
  { title: "成約・稼働", body: "条件確認書の締結〜月次の稼働確認まで" },
];

const FEATURES = [
  {
    tag: "AI取込",
    title: "書類を放り込むだけで登録",
    body: "案件票・スキルシートをアップロードや貼り付けで取込。AIがスキル・単価・時期を抽出し、人が確認して確定します。",
  },
  {
    tag: "双方向マッチング",
    title: "案件からも人材からも探せる",
    body: "必須スキル・単価・時期・出社条件で自動判定し、マッチ度を点数表示。候補選びの時間を大幅に短縮します。",
  },
  {
    tag: "商談管理",
    title: "申込みから成約まで記録が残る",
    body: "商談の申込み・承認・面談調整・メッセージ・条件確認書・稼働確認まで、経緯がすべて一箇所に残ります。",
  },
];

const COMPARE: [string, string, string][] = [
  ["向いている会社", "すぐに始めたい／手元にサーバを持ちたくない", "案件・人材データを自社環境に置きたい／書類の全量整理から始めたい"],
  ["データの置き場所", "プラットフォーム上で管理（テナント分離・段階開示で保護）", "全量は自社環境。商談に出す分だけを公開送信"],
  ["AI解析", "プラットフォームのAIが解析（追加費用なし）", "自社契約のAI（クラウド／社内LLM）で解析"],
  ["準備", "企業登録のみ。ブラウザだけで利用可", "企業登録＋一般的なPCにインストール（約5分）"],
  ["費用", "成約手数料のみ", "成約手数料のみ（Connector本体は無料）"],
];

export default function AboutPage() {
  return (
    <article className="text-sm leading-relaxed text-slate-700">
      {/* ヒーロー */}
      <p className="inline-block rounded-full border border-blue-600 px-3 py-0.5 text-xs font-bold tracking-wider text-blue-700">
        AI人材・案件ダイレクトマッチングプラットフォーム
      </p>
      <p className="mt-4 text-2xl font-extrabold text-blue-700">SES DirectMatch</p>
      <h1 className="mt-1 text-2xl font-extrabold leading-snug text-slate-900 sm:text-3xl">
        案件と人材を、余計な商流なしで直接つなぐ。
      </h1>
      <p className="mt-4 max-w-2xl">
        SES DirectMatch は、SES企業同士が案件と人材を直接マッチングし、商談・面談・成約・稼働管理までを
        一つのプラットフォームで完結できるサービスです。データを自社に置いたまま使える連携ツール
        「SES-Connector」も無料で提供しています。
      </p>

      {/* お悩み */}
      <h2 className="mt-10 text-lg font-extrabold text-slate-900">SESの営業現場、こうなっていませんか</h2>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PAINS.map((p) => (
          <div key={p.title} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="font-bold text-slate-900">{p.title}</p>
            <p className="mt-1 text-xs text-slate-500">{p.body}</p>
          </div>
        ))}
      </div>

      {/* DirectMatch */}
      <h2 className="mt-10 text-lg font-extrabold text-slate-900">探す・商談する・成約する。全部ここで</h2>
      <div className="mt-4 overflow-x-auto">
        <div className="flex min-w-[640px] items-stretch gap-2">
          {JOURNEY.map((s, i) => (
            <div key={s.title} className="flex flex-1 items-center gap-2">
              <div className="flex-1 rounded-lg border border-slate-200 bg-white p-3 text-center">
                <p className="font-bold text-slate-900">{s.title}</p>
                <p className="mt-0.5 text-xs leading-snug text-slate-500">{s.body}</p>
              </div>
              {i < JOURNEY.length - 1 && <span className="shrink-0 font-extrabold text-slate-400">→</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-lg border border-slate-200 bg-white p-4">
            <span className="inline-block rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold tracking-wider text-blue-700">
              {f.tag}
            </span>
            <p className="mt-2 font-bold text-slate-900">{f.title}</p>
            <p className="mt-1 text-xs text-slate-500">{f.body}</p>
          </div>
        ))}
      </div>

      {/* SES-Connector */}
      <h2 className="mt-10 text-lg font-extrabold text-slate-900">
        SES-Connector — データを自社に置いたまま使う選択肢
      </h2>
      <p className="mt-2">
        「データは預けたくない。でも商談先は広げたい」に応える無料の連携ツールです。
        案件票・スキルシートは自社のPC・サーバで管理し、商談に出したい1件だけを公開送信します。
      </p>
      <div className="mt-4 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div className="rounded-xl border-2 border-emerald-700 bg-emerald-50 p-4">
          <p className="font-extrabold text-emerald-800">自社環境（SES-Connector）</p>
          <p className="text-xs text-slate-500">お使いのPC・社内サーバで動作 — データはここに残ります</p>
          <ul className="mt-2 space-y-1.5 text-xs">
            <li className="rounded bg-white p-2">書類を取込（アップロード・貼り付け・フォルダ投入）</li>
            <li className="rounded bg-white p-2">個人情報を自動マスキングしてから自社契約のAIで整理</li>
            <li className="rounded bg-white p-2">ローカル在庫として一覧・編集・管理</li>
            <li className="rounded bg-white p-2">公開案件・公開人材の検索とマッチ度表示もローカル画面から</li>
          </ul>
        </div>
        <div className="flex items-center justify-center px-1 font-bold tracking-widest text-slate-700 sm:flex-col">
          <span className="sm:rotate-0">→</span>
          <span className="mx-1 text-xs sm:mx-0 sm:my-1 sm:[writing-mode:vertical-rl]">公開送信</span>
          <span>→</span>
        </div>
        <div className="rounded-xl border-2 border-blue-600 bg-blue-50 p-4">
          <p className="font-extrabold text-blue-700">SES DirectMatch</p>
          <p className="text-xs text-slate-500">商談に出すと決めた分だけが、ここに掲載されます</p>
          <ul className="mt-2 space-y-1.5 text-xs">
            <li className="rounded bg-white p-2">匿名で掲載・検索（氏名・単価実額は非公開）</li>
            <li className="rounded bg-white p-2">人材提案・案件紹介で商談を申込み</li>
            <li className="rounded bg-white p-2">双方承認で実名・実額を相互開示</li>
            <li className="rounded bg-white p-2">成約・稼働・手数料まで一貫管理</li>
          </ul>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        公開前に内容を画面で確認・修正できるので、意図しない情報が外に出ることはありません。
        無料・オープンソース（MITライセンス）で、ソースコードは{" "}
        <a
          href="https://github.com/lykuroai/lykuro-connector"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-700 underline"
        >
          GitHub
        </a>
        で全て公開しています。
      </p>

      {/* 使い方比較 */}
      <h2 className="mt-10 text-lg font-extrabold text-slate-900">使い方は2通り</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-xs">
          <thead>
            <tr>
              <th className="w-28 border border-slate-200 bg-slate-50 p-2"></th>
              <th className="border border-slate-200 bg-slate-50 p-2 text-left font-bold text-blue-700">
                Webコンソールだけで使う
              </th>
              <th className="border border-slate-200 bg-slate-50 p-2 text-left font-bold text-emerald-800">
                SES-Connector と組み合わせる
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARE.map(([label, a, b]) => (
              <tr key={label}>
                <th className="whitespace-nowrap border border-slate-200 bg-slate-50 p-2 text-left font-bold">
                  {label}
                </th>
                <td className="border border-slate-200 p-2">{a}</td>
                <td className="border border-slate-200 p-2">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 安心設計 */}
      <h2 className="mt-10 text-lg font-extrabold text-slate-900">個人情報は、段階開示とテナント分離で守ります</h2>
      <ol className="mt-3 list-decimal space-y-1 pl-5">
        <li>
          <b className="text-blue-700">掲載・検索</b> —
          年代・スキル・単価帯などの匿名情報のみ。氏名・単価実額・企業名は非公開
        </li>
        <li>
          <b className="text-blue-700">双方承認</b> —
          商談をお互いが承認したときに初めて、氏名・実額・企業名を同時に相互開示
        </li>
        <li>
          <b className="text-blue-700">成約</b> — 条件確認書の締結・稼働確認・成約手数料までプラットフォームが記録
        </li>
      </ol>
      <p className="mt-3 text-xs text-slate-500">
        このほか、企業データの行レベル分離（他社からは見えない）、AI解析前の個人情報匿名化、参加企業の運営審査、
        再転載・無承認再仲介の通報窓口など、企業間取引を安全に保つ仕組みを備えています。
        商流は最大一社下までに制限し、多重下請けを防ぎます。
      </p>

      {/* 料金 */}
      <h2 className="mt-10 text-lg font-extrabold text-slate-900">成約するまで、費用はかかりません</h2>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border-2 border-blue-600 bg-white p-5">
          <p className="font-extrabold text-slate-900">SES DirectMatch</p>
          <p className="text-3xl font-extrabold text-blue-700">成約手数料 3%</p>
          <p className="text-xs text-slate-500">登録・掲載・検索・商談まで無料</p>
          <ul className="mt-2 list-disc pl-5 text-xs text-slate-500">
            <li>費用が発生するのは成約して稼働が始まってから</li>
            <li>確定契約金額の3%を、人材を受け入れる企業のみ負担（最大12稼働月）</li>
            <li>稼働前のキャンセルは0円</li>
          </ul>
        </div>
        <div className="rounded-xl border-2 border-emerald-700 bg-white p-5">
          <p className="font-extrabold text-slate-900">SES-Connector</p>
          <p className="text-3xl font-extrabold text-emerald-700">¥0</p>
          <p className="text-xs text-slate-500">無料・オープンソース（MITライセンス）</p>
          <ul className="mt-2 list-disc pl-5 text-xs text-slate-500">
            <li>ソースコードは GitHub で全公開</li>
            <li>利用台数・件数の制限なし</li>
            <li>AI利用料（自社契約分）のみ各社負担</li>
          </ul>
        </div>
      </div>

      {/* 導入の流れ */}
      <h2 className="mt-10 text-lg font-extrabold text-slate-900">今日申し込んで、審査後すぐに使えます</h2>
      <ol className="mt-3 space-y-2">
        {[
          ["企業登録を申込み", "企業情報を入力し、メールアドレス確認のうえ受付", false],
          ["運営審査 → 利用開始", "審査完了の通知が届いたら、ブラウザで案件・人材の登録と商談を開始できます", false],
          ["（任意）SES-Connector を導入", "会社マイページの案内から約5分でインストール。データを自社に置く運用に切り替えられます", true],
        ].map(([title, body, optional], i) => (
          <li key={String(title)} className="flex gap-3">
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${optional ? "bg-emerald-700" : "bg-blue-600"}`}
            >
              {i + 1}
            </span>
            <div>
              <p className="font-bold text-slate-900">{title}</p>
              <p className="text-xs text-slate-500">{body}</p>
            </div>
          </li>
        ))}
      </ol>

      {/* CTA */}
      <div className="mt-10 rounded-xl bg-slate-900 p-6 text-slate-100">
        <p className="text-lg font-extrabold text-white">埋まらない案件と待機人材に、新しい出会いを</p>
        <p className="mt-1 text-xs text-slate-400">
          登録から商談まで無料です。まずは自社の案件・人材を掲載して、どんな商談が来るかお確かめください。
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/apply"
            className="rounded bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-700"
          >
            企業登録を申し込む（無料）
          </Link>
          <a
            href="https://github.com/lykuroai/lykuro-connector"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-slate-500 px-5 py-2 text-sm font-bold text-slate-100 hover:bg-slate-800"
          >
            SES-Connector（GitHub）
          </a>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-slate-400">
        SES DirectMatch（ses.lykuro.ai）／ SES-Connector ｜ 運営: 株式会社ｅビジネスソリューション
      </p>
    </article>
  );
}
