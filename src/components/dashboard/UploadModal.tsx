"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

// Upload modal (2026-10-05, permintaan Agus "modal upload pilih kanal") - pilih kanal mana
// yang dipublish + edit caption SEBELUM publish (dulu langsung ke SEMUA kanal terhubung).
// Dipakai dari Planner (publish per baris) & BuatKonten (Studio preview "Upload ke Kanal").
type Account = { id: string; platform: string; connected: boolean; displayName?: string | null };

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
  twitter: "Twitter/X",
  linkedin: "LinkedIn",
};

export function UploadModal({
  brandId,
  projectId,
  onClose,
  onDone,
}: {
  brandId: string;
  projectId: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [caption, setCaption] = useState("");
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [accs, proj] = await Promise.all([
          fetch(`/api/brands/${brandId}/social-accounts`).then((r) => r.json()),
          fetch(`/api/projects/${projectId}`).then((r) => r.json()),
        ]);
        const connected: Account[] = (Array.isArray(accs) ? accs : []).filter((a: Account) => a.connected);
        setAccounts(connected);
        setSelected(new Set(connected.map((a) => a.id))); // default: semua terpilih
        const tags: string[] = proj.generatedHashtags ? JSON.parse(proj.generatedHashtags) : [];
        const base = proj.generatedCaption || "";
        setCaption(tags.length ? `${base}\n\n${tags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ")}` : base);
      } catch {
        toast.error("Gagal memuat kanal/caption.");
        setAccounts([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [brandId, projectId]);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function publish() {
    if (selected.size === 0) {
      toast.error("Pilih minimal 1 kanal.");
      return;
    }
    if (!confirm(`Publikasikan ke ${selected.size} kanal sekarang?`)) return;
    setPublishing(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountIds: [...selected], caption }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Gagal publikasi.");
      toast.success("Dipublikasikan.");
      onDone?.();
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Gagal publikasi.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading text-lg font-bold text-[#151c27]">Publikasikan Konten</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#f0f3ff] text-[#555f6d]">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {loading ? (
          <p className="text-[13px] text-[#555f6d] py-8 text-center">Memuat...</p>
        ) : (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#555f6d] mb-1.5">Kanal tujuan</p>
            {accounts && accounts.length > 0 ? (
              <div className="flex flex-col gap-1.5 mb-4">
                {accounts.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 rounded-lg bg-[#f0f3ff] px-3 py-2 cursor-pointer">
                    <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} className="accent-black w-4 h-4" />
                    <span className="text-[13px] text-[#151c27]">{PLATFORM_LABEL[a.platform] || a.platform}</span>
                    {a.displayName && <span className="text-[11px] text-[#555f6d]">· {a.displayName}</span>}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-[#ba1a1a] bg-[#ffdad6] rounded-lg px-3 py-2 mb-4">Belum ada kanal terhubung untuk brand ini.</p>
            )}

            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#555f6d] mb-1.5">Caption</p>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={6}
              className="w-full rounded-lg ring-1 ring-[#e7eefe] focus:ring-[#c6c6cd] outline-none p-2.5 text-[13px] text-[#151c27] resize-y mb-4"
              placeholder="Caption yang akan diposting..."
            />

            <div className="flex items-center justify-end gap-2">
              <button onClick={onClose} className="px-3 py-2 rounded-lg bg-white ring-1 ring-[#e7eefe] hover:ring-[#c6c6cd] text-[13px] font-medium text-[#151c27]">Batal</button>
              <button
                onClick={publish}
                disabled={publishing || !accounts || accounts.length === 0}
                className="px-4 py-2 rounded-lg bg-black text-white text-[13px] font-medium flex items-center gap-1.5 hover:bg-[#2a313d] disabled:opacity-60"
              >
                <span className={"material-symbols-outlined text-[16px] " + (publishing ? "animate-spin" : "")}>{publishing ? "progress_activity" : "send"}</span>
                Publikasikan
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
