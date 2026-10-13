import type { ReactNode } from "react";

export function FieldList({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,40%)_1fr] gap-x-3 gap-y-2 px-4 py-3 text-[13px]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-text-3">{label}</dt>
          <dd className="min-w-0 break-words text-text">{value === null || value === undefined || value === "" ? <span className="text-text-3">—</span> : value}</dd>
        </div>
      ))}
    </dl>
  );
}
