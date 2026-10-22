/**
 * Manage a companion's locked visual identity: reference photos (one primary
 * face), immutable descriptor traits, and the lock toggle.
 */
import { useEffect, useState } from "react";
import { Lock, Unlock, Star, Upload, Loader } from "lucide-react";
import {
  fetchIdentity,
  saveIdentity,
  uploadReference,
  type ReferenceImage,
  type VisualDescriptor,
  type VisualIdentity,
} from "@/lib/photo/photoApi";
import { downscaleDataUrl } from "@/lib/downscaleImage";

const FIELDS: Array<[keyof VisualDescriptor, string]> = [
  ["age_range", "Age"],
  ["skin_tone", "Skin tone"],
  ["eye_color", "Eyes"],
  ["hair_color", "Hair colour"],
  ["hair_style", "Hair style"],
  ["face_shape", "Face"],
  ["body_type", "Build"],
  ["signature_outfit", "Signature outfit"],
];

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function IdentityLockPanel({
  characterId,
  characterName,
  fallbackAvatar,
}: {
  characterId: string;
  characterName?: string;
  fallbackAvatar?: string;
}) {
  const [identity, setIdentity] = useState<VisualIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [descriptor, setDescriptor] = useState<VisualDescriptor>({});

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchIdentity(characterId)
      .then((id) => {
        if (!alive) return;
        setIdentity(id);
        setDescriptor(id?.descriptor || { style: "photoreal" });
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [characterId]);

  const refs = identity?.reference_images || [];
  const locked = Boolean(identity?.locked);

  const persist = async (patch: Partial<VisualIdentity>) => {
    setSaving(true);
    setError("");
    try {
      setIdentity(await saveIdentity(characterId, { character_name: characterName, ...patch }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setSaving(true);
    try {
      const added: ReferenceImage[] = [];
      for (const file of Array.from(files).slice(0, 6)) {
        const small = await downscaleDataUrl(await readFile(file), 1024, 0.86);
        added.push(await uploadReference(characterId, small, { kind: "face", is_primary: !refs.length && !added.length }));
      }
      await persist({ reference_images: [...refs, ...added] });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-3 flex items-center gap-2 font-mono text-[10px] text-primary/50">
        <Loader className="w-3 h-3 animate-spin" /> Loading identity…
      </div>
    );
  }

  return (
    <div className="p-3 border-b border-primary/15 space-y-2">
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
        {refs.map((r, i) => (
          <button
            key={r.storage_path || r.url}
            type="button"
            disabled={locked}
            onClick={() => persist({ reference_images: refs.map((x, j) => ({ ...x, is_primary: i === j })) })}
            className={`relative w-14 h-14 flex-shrink-0 border ${r.is_primary ? "border-primary" : "border-primary/20"}`}
            title={r.is_primary ? "Primary face reference" : "Make primary"}
          >
            <img src={r.url} alt="" className="w-full h-full object-cover" />
            {r.is_primary && <Star className="absolute top-0.5 right-0.5 w-3 h-3 text-primary fill-primary" />}
          </button>
        ))}
        {!refs.length && fallbackAvatar && (
          <span className="font-mono text-[9px] text-primary/40">No references yet — upload 3–6 clear face photos.</span>
        )}
        {!locked && (
          <label className="w-14 h-14 flex-shrink-0 border border-dashed border-primary/30 flex items-center justify-center cursor-pointer text-primary/50">
            <Upload className="w-4 h-4" />
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
          </label>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1">
        {FIELDS.map(([key, label]) => (
          <input
            key={key}
            disabled={locked}
            value={String(descriptor[key] ?? "")}
            onChange={(e) => setDescriptor((d) => ({ ...d, [key]: e.target.value }))}
            placeholder={label}
            className="bg-black/60 border border-primary/15 text-primary/80 placeholder-primary/25 font-mono text-[11px] px-2 py-1 focus:outline-none disabled:opacity-50"
          />
        ))}
      </div>

      {error && <p className="font-mono text-[10px] text-red-400/80">{error}</p>}

      <div className="flex gap-2">
        {!locked && (
          <button
            type="button"
            disabled={saving}
            onClick={() => persist({ descriptor })}
            className="flex-1 py-1.5 border border-primary/30 text-primary/80 font-mono text-[10px] uppercase tracking-widest"
          >
            Save traits
          </button>
        )}
        <button
          type="button"
          disabled={saving || (!locked && !refs.length)}
          onClick={() => persist(locked ? { locked: false } : { locked: true, descriptor })}
          className="flex-1 py-1.5 border border-primary/40 text-primary font-mono text-[10px] uppercase tracking-widest flex items-center justify-center gap-1 disabled:opacity-30"
        >
          {locked ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
          {locked ? "Unlock" : "Lock identity"}
        </button>
      </div>
      {identity && <p className="font-mono text-[8px] text-primary/30 uppercase tracking-widest">Identity v{identity.version}</p>}
    </div>
  );
}
