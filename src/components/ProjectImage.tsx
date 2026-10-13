// 案件一覧のイメージ画像（案件内容から判定した種別ごとのイラスト。インライン SVG）。
// 純粋な表示コンポーネントのため RSC から使用可。外部画像は使わない。
import {
  PROJECT_IMAGE_LABELS,
  type ProjectImageKind,
} from "@/lib/project-image";

// 種別ごとの配色（背景 / 線色）と 24x24 のアイコンパス
const STYLES: Record<
  ProjectImageKind,
  { bg: string; fg: string; paths: string[] }
> = {
  finance: {
    bg: "bg-amber-50",
    fg: "text-amber-700",
    paths: [
      "M3 10h18",
      "M5 10V19M9 10V19M15 10V19M19 10V19",
      "M3 19h18",
      "M12 3l9 6H3l9-6z",
    ],
  },
  telecom: {
    bg: "bg-sky-50",
    fg: "text-sky-700",
    paths: [
      "M12 20V11",
      "M8.5 8.5a5 5 0 0 1 7 0",
      "M6 6a8.5 8.5 0 0 1 12 0",
      "M3.5 3.5a12 12 0 0 1 17 0",
      "M12 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
    ],
  },
  manufacturing: {
    bg: "bg-slate-100",
    fg: "text-slate-700",
    paths: [
      "M3 20V9l5 3V9l5 3V9l5 3v8H3z",
      "M7 16h2M11 16h2M15 16h2",
      "M17 9V4h2v5",
    ],
  },
  logistics: {
    bg: "bg-orange-50",
    fg: "text-orange-700",
    paths: [
      "M2 7h11v9H2z",
      "M13 10h4l3 3v3h-7z",
      "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
      "M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
    ],
  },
  retail: {
    bg: "bg-pink-50",
    fg: "text-pink-700",
    paths: ["M4 7h16l-1.5 12h-13L4 7z", "M9 11V6a3 3 0 0 1 6 0v5"],
  },
  public: {
    bg: "bg-indigo-50",
    fg: "text-indigo-700",
    paths: [
      "M4 20h16",
      "M5 20V10M9 20V10M15 20V10M19 20V10",
      "M3 10h18",
      "M12 3l9 7H3l9-7z",
      "M12 6v1",
    ],
  },
  healthcare: {
    bg: "bg-rose-50",
    fg: "text-rose-700",
    paths: ["M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z"],
  },
  education: {
    bg: "bg-teal-50",
    fg: "text-teal-700",
    paths: [
      "M2 9l10-5 10 5-10 5L2 9z",
      "M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5",
      "M22 9v6",
    ],
  },
  energy: {
    bg: "bg-yellow-50",
    fg: "text-yellow-700",
    paths: ["M13 2L4 14h7l-1 8 9-12h-7l1-8z"],
  },
  construction: {
    bg: "bg-stone-100",
    fg: "text-stone-700",
    paths: ["M3 21h18", "M5 21V8l7-5 7 5v13", "M9 21v-6h6v6", "M10 11h4"],
  },
  media: {
    bg: "bg-fuchsia-50",
    fg: "text-fuchsia-700",
    paths: ["M3 6h18v12H3z", "M10 9l5 3-5 3V9z"],
  },
  hr: {
    bg: "bg-lime-50",
    fg: "text-lime-700",
    paths: [
      "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
      "M2 20a7 7 0 0 1 14 0",
      "M16 4.5a3.5 3.5 0 0 1 0 6.5",
      "M18 13.5a6 6 0 0 1 4 6.5",
    ],
  },
  web: {
    bg: "bg-blue-50",
    fg: "text-blue-700",
    paths: [
      "M3 5h18v14H3z",
      "M3 9h18",
      "M6 7h1M8.5 7h1",
      "M8 16l-2-2 2-2M16 16l2-2-2-2M13 11l-2 6",
    ],
  },
  mobile: {
    bg: "bg-violet-50",
    fg: "text-violet-700",
    paths: [
      "M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z",
      "M10 19h4",
      "M6 6h12M6 16h12",
    ],
  },
  cloud: {
    bg: "bg-cyan-50",
    fg: "text-cyan-700",
    paths: [
      "M7 18a4 4 0 0 1-.5-7.96A6 6 0 0 1 18 8.5 4.5 4.5 0 0 1 17.5 18H7z",
      "M9 14h6",
    ],
  },
  data: {
    bg: "bg-emerald-50",
    fg: "text-emerald-700",
    paths: [
      "M12 7c5 0 8-1.3 8-3s-3-3-8-3-8 1.3-8 3 3 3 8 3z",
      "M4 4v8c0 1.7 3 3 8 3s8-1.3 8-3V4",
      "M4 12v8c0 1.7 3 3 8 3s8-1.3 8-3v-8",
    ],
  },
  embedded: {
    bg: "bg-zinc-100",
    fg: "text-zinc-700",
    paths: [
      "M7 7h10v10H7z",
      "M10 10h4v4h-4z",
      "M9 2v5M12 2v5M15 2v5M9 17v5M12 17v5M15 17v5",
      "M2 9h5M2 12h5M2 15h5M17 9h5M17 12h5M17 15h5",
    ],
  },
  security: {
    bg: "bg-red-50",
    fg: "text-red-700",
    paths: [
      "M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5l8-3z",
      "M9 12l2 2 4-4",
    ],
  },
  business: {
    bg: "bg-slate-100",
    fg: "text-slate-600",
    paths: ["M3 7h18v12H3z", "M8 7V4h8v3", "M3 12h18", "M12 11v3"],
  },
};

export function ProjectImage({
  kind,
  size = 40,
  className = "",
}: {
  kind: ProjectImageKind;
  size?: number;
  className?: string;
}) {
  const s = STYLES[kind];
  const label = `${PROJECT_IMAGE_LABELS[kind]}のイメージ`;
  return (
    <span
      title={PROJECT_IMAGE_LABELS[kind]}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg ${s.bg} ${s.fg} ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        role="img"
        aria-label={label}
        width={Math.round(size * 0.6)}
        height={Math.round(size * 0.6)}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <title>{label}</title>
        {s.paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>
    </span>
  );
}
