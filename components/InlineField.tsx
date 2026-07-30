"use client";

import { useEffect, useRef, useState } from "react";

// Inline editing with autosave (v2.2): fields look like typeset data until
// focused; edits persist on debounce/blur with a quiet per-field status.

type Status = "idle" | "saving" | "saved" | "error";

function useAutosave<T>(persist: (v: T) => Promise<void>) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function save(v: T) {
    setStatus("saving");
    setMessage("");
    try {
      await persist(v);
      setStatus("saved");
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
      fadeTimer.current = setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1600);
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "save failed");
    }
  }

  useEffect(() => () => {
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
  }, []);

  return { status, message, save };
}

function StatusMark({ status, message }: { status: Status; message: string }) {
  if (status === "idle") return null;
  return (
    <span
      className={`ml-2 font-mono text-[9px] uppercase tracking-[0.1em] ${
        status === "error"
          ? "text-signal-red"
          : status === "saved"
            ? "text-signal-green"
            : "text-dim-500"
      }`}
    >
      {status === "saving" ? "saving…" : status === "saved" ? "saved" : `error: ${message}`}
    </span>
  );
}

export function InlineText({
  label,
  value,
  onSave,
  placeholder,
  multiline,
  big,
  mono,
  inputRef,
}: {
  label?: string;
  value: string;
  onSave: (v: string) => Promise<void>;
  placeholder?: string;
  multiline?: boolean;
  big?: boolean;
  mono?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
}) {
  const [draft, setDraft] = useState(value);
  const lastSaved = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { status, message, save } = useAutosave<string>(async (v) => {
    await onSave(v);
    lastSaved.current = v;
  });

  useEffect(() => {
    setDraft(value);
    lastSaved.current = value;
  }, [value]);

  function queue(v: string) {
    setDraft(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (v !== lastSaved.current) void save(v);
    }, 800);
  }

  function flush() {
    if (timer.current) clearTimeout(timer.current);
    if (draft !== lastSaved.current) void save(draft);
  }

  const cls = `w-full rounded-sm border border-transparent bg-transparent px-1.5 py-1 outline-none transition-colors placeholder:text-dim-500/50 hover:border-ink-600 focus:border-signal-cyan/50 focus:bg-ink-900 ${
    big ? "text-lg font-semibold text-dim-100" : "text-[13px] text-dim-200"
  } ${mono ? "font-mono" : ""}`;

  return (
    <div className="min-w-0">
      {label && (
        <span className="field-label">
          {label}
          <StatusMark status={status} message={message} />
        </span>
      )}
      {!label && status !== "idle" && (
        <div className="text-right">
          <StatusMark status={status} message={message} />
        </div>
      )}
      {multiline ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement> | undefined}
          className={`${cls} min-h-[64px] resize-y leading-relaxed`}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => queue(e.target.value)}
          onBlur={flush}
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement> | undefined}
          className={cls}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => queue(e.target.value)}
          onBlur={flush}
          onKeyDown={(e) => {
            // Esc = blur and save (v2.2 §5); Enter commits single-line fields.
            if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
          }}
        />
      )}
    </div>
  );
}

export function InlineSelect<T extends string>({
  label,
  value,
  options,
  onSave,
  display,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onSave: (v: T) => Promise<void>;
  display?: (v: T) => string;
}) {
  const { status, message, save } = useAutosave<T>(onSave);
  return (
    <div>
      <span className="field-label">
        {label}
        <StatusMark status={status} message={message} />
      </span>
      <select
        className="w-full rounded-sm border border-transparent bg-transparent px-1 py-1 font-mono text-[12px] uppercase text-dim-200 outline-none hover:border-ink-600 focus:border-signal-cyan/50 focus:bg-ink-900"
        value={value}
        onChange={(e) => void save(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-ink-900">
            {display ? display(o) : o.replace(/_/g, " ").toLowerCase()}
          </option>
        ))}
      </select>
    </div>
  );
}

export function InlineLinkSelect({
  label,
  value,
  options,
  onSave,
  none,
}: {
  label: string;
  value: string | null;
  options: Array<{ id: string; label: string }>;
  onSave: (v: string | null) => Promise<void>;
  none: string;
}) {
  const { status, message, save } = useAutosave<string | null>(onSave);
  return (
    <div>
      <span className="field-label">
        {label}
        <StatusMark status={status} message={message} />
      </span>
      <select
        className="w-full rounded-sm border border-transparent bg-transparent px-1 py-1 text-[13px] text-dim-200 outline-none hover:border-ink-600 focus:border-signal-cyan/50 focus:bg-ink-900"
        value={value ?? ""}
        onChange={(e) => void save(e.target.value || null)}
      >
        <option value="" className="bg-ink-900">
          {none}
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id} className="bg-ink-900">
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function InlineDate({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string | null;
  onSave: (v: string | null) => Promise<void>;
}) {
  const { status, message, save } = useAutosave<string | null>(onSave);
  return (
    <div>
      <span className="field-label">
        {label}
        <StatusMark status={status} message={message} />
      </span>
      <input
        type="date"
        className="w-full rounded-sm border border-transparent bg-transparent px-1 py-1 font-mono text-[12px] text-dim-200 outline-none hover:border-ink-600 focus:border-signal-cyan/50 focus:bg-ink-900"
        value={value ?? ""}
        onChange={(e) => void save(e.target.value || null)}
      />
    </div>
  );
}

export function InlineNumber({
  label,
  value,
  onSave,
}: {
  label: string;
  value: number | null;
  onSave: (v: number | null) => Promise<void>;
}) {
  const { status, message, save } = useAutosave<number | null>(onSave);
  return (
    <div>
      <span className="field-label">
        {label}
        <StatusMark status={status} message={message} />
      </span>
      <input
        type="number"
        className="w-full rounded-sm border border-transparent bg-transparent px-1 py-1 font-mono text-[12px] text-dim-200 outline-none hover:border-ink-600 focus:border-signal-blue/50 focus:bg-ink-900"
        defaultValue={value ?? ""}
        onBlur={(e) => {
          const v = e.target.value.trim();
          void save(v === "" ? null : Number(v));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

// Array-of-strings editor (stakeholders, themes): comma-separated inline.
export function InlineTags({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string[];
  onSave: (v: string[]) => Promise<void>;
}) {
  const { status, message, save } = useAutosave<string[]>(onSave);
  return (
    <div>
      <span className="field-label">
        {label}
        <StatusMark status={status} message={message} />
      </span>
      <input
        className="w-full rounded-sm border border-transparent bg-transparent px-1 py-1 text-[13px] text-dim-200 outline-none hover:border-ink-600 focus:border-signal-blue/50 focus:bg-ink-900"
        defaultValue={value.join(", ")}
        placeholder="comma, separated"
        onBlur={(e) => {
          void save(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          );
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

export function InlineToggle({
  label,
  value,
  onSave,
  caption,
}: {
  label: string;
  value: boolean;
  onSave: (v: boolean) => Promise<void>;
  caption: string;
}) {
  const { status, message, save } = useAutosave<boolean>(onSave);
  return (
    <div>
      <span className="field-label">
        {label}
        <StatusMark status={status} message={message} />
      </span>
      <label className="flex cursor-pointer items-center gap-2 px-1 py-1 text-[12px] text-dim-300">
        <input
          type="checkbox"
          className="accent-[#9d8cff]"
          checked={value}
          onChange={(e) => void save(e.target.checked)}
        />
        {caption}
      </label>
    </div>
  );
}
