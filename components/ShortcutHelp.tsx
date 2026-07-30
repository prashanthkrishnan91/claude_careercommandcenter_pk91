"use client";

const GROUPS: Array<{ name: string; rows: Array<[string[], string]> }> = [
  {
    name: "Capture",
    rows: [
      [["N"], "Quick Log an achievement in the current context (also ⌘N where the browser allows)"],
      [["Esc"], "Blur the field — edits save on blur"],
      [["E"], "Edit the focused field"],
    ],
  },
  {
    name: "Records",
    rows: [
      [["J"], "Next row"],
      [["K"], "Previous row"],
      [["↵"], "Open the selected row"],
      [["⌘", "↵"], "Promote an eligible draft achievement"],
      [["⌘", "⇧", "A"], "Archive the focused item"],
    ],
  },
  {
    name: "Anywhere",
    rows: [[["?"], "This overlay"]],
  },
];

export default function ShortcutHelp() {
  return (
    <div className="space-y-5">
      {GROUPS.map((g) => (
        <section key={g.name}>
          <h3 className="microlabel mb-2">{g.name}</h3>
          <table className="w-full">
            <tbody>
              {g.rows.map(([keys, desc]) => (
                <tr key={desc} className="border-b border-ink-800 last:border-0">
                  <td className="w-32 py-1.5 pr-3">
                    <span className="flex gap-1">{keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
                  </td>
                  <td className="py-1.5 text-[12px] text-dim-300">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
