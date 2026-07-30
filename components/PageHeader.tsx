"use client";

export default function PageHeader({
  crumb,
  title,
  count,
  action,
  children,
}: {
  crumb: string;
  title?: string;
  count?: number;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="hairline-b sticky top-0 z-10 bg-ink-900/95 px-4 pt-4 backdrop-blur md:px-8">
      <div className="flex items-end justify-between gap-3 pb-3">
        <div className="min-w-0">
          <div className="microlabel">{crumb}</div>
          {title && (
            <h1 className="mt-1 truncate text-lg font-semibold text-dim-100">
              {title}
              {count !== undefined && <span className="ml-2 font-mono text-[11px] text-dim-500">{count}</span>}
            </h1>
          )}
        </div>
        {action && <div className="shrink-0 pb-0.5">{action}</div>}
      </div>
      {children && <div className="pb-3">{children}</div>}
    </header>
  );
}
