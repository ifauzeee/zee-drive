import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { api, ApiError, kindOf } from "../api";
import type { Crumb, DriveFile } from "../types";
import { navigate } from "../nav";

type NodeState = {
  children: DriveFile[] | null;
  expanded: boolean;
  loading: boolean;
  locked: boolean;
  failed: boolean;
};

const EMPTY: NodeState = { children: null, expanded: false, loading: false, locked: false, failed: false };

export default function FolderTree({
  rootId,
  activeId,
  crumbs,
  open,
  onClose,
}: {
  rootId: string;
  activeId?: string;
  crumbs: Crumb[] | null;
  open: boolean;
  onClose: () => void;
}) {
  const [nodes, setNodes] = useState<Record<string, NodeState>>({});

  const setNode = (id: string, patch: Partial<NodeState>) =>
    setNodes((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY), ...patch } }));

  const load = async (id: string, force = false) => {
    const cur = nodes[id] ?? EMPTY;
    if (cur.loading || (cur.expanded && cur.children !== null && !force)) return;
    setNode(id, { loading: true, locked: false, failed: false });
    try {
      const res = await api.files(id);
      const sorted = [...res.files].sort(
        (a, b) =>
          Number(kindOf(b.mimeType) === "folder") - Number(kindOf(a.mimeType) === "folder") ||
          a.name.localeCompare(b.name),
      );
      setNode(id, {
        children: sorted,
        expanded: true,
        loading: false,
      });
    } catch (e) {
      const locked = e instanceof ApiError && e.locked;
      setNode(id, { loading: false, failed: !locked, locked: !!locked });
    }
  };

  // Auto-expand the active folder path (and load the root's children on mount).
  useEffect(() => {
    if (!crumbs?.length) return;
    for (const c of crumbs) void load(c.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, crumbs]);

  // Reset the tree when back at root: open subfolders collapse too.
  useEffect(() => {
    if (activeId !== rootId) return;
    setNodes({});
  }, [activeId, rootId]);

  const go = (id: string) => {
    navigate(`/b/${encodeURIComponent(id)}`);
    onClose();
  };

  const toggle = (id: string) => {
    const cur = nodes[id] ?? EMPTY;
    if (cur.expanded) setNode(id, { expanded: false });
    else void load(id);
  };

  const renderEntry = (f: DriveFile, depth: number): ReactNode => {
    const id = f.id;
    const n = nodes[id] ?? EMPTY;
    const active = id === activeId;
    const isFolder = kindOf(f.mimeType) === "folder";
    return (
      <li key={id} className={`tree-item${active ? " current" : ""}`} style={{ "--depth": depth } as CSSProperties} data-kind={isFolder ? "folder" : "file"}>
        <div className="tree-row">
          {isFolder ? (
            <button
              className="tree-chev"
              onClick={() => toggle(id)}
              aria-expanded={n.expanded && !n.locked}
              aria-label={`${n.expanded ? "Tutup" : "Buka"} folder ${f.name}`}
            >
              {n.loading ? <SpinnerDot /> : n.expanded ? <ChevDownGlyph /> : <ChevRightGlyph />}
            </button>
          ) : null}
          <button className="tree-open" onClick={() => (isFolder ? go(id) : navigate(`/f/${encodeURIComponent(id)}`))} title={f.name}>
            {isFolder ? <FolderGlyph /> : <FileGlyph />}
            <span className="tree-label">{f.name}</span>
          </button>
        </div>
        {n.locked ? (
          <div className="tree-unlock">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const v = new FormData(e.currentTarget).get("pw");
                if (typeof v !== "string" || !v) return;
                try {
                  await api.unlock(id, v);
                  await load(id, true);
                } catch {
                  /* stays visible — no per-node message */
                }
              }}
            >
              <input name="pw" type="password" placeholder="Kata sandi" autoComplete="off" />
              <button type="submit">Buka</button>
            </form>
          </div>
        ) : null}
        {n.failed ? (
          <div className="tree-fail">
            <span>Gagal memuat.</span>
            <button onClick={() => void load(id, true)}>Coba lagi</button>
          </div>
        ) : null}
        {n.children && n.expanded ? (
          <ul className="tree-children">{n.children.map((c) => renderEntry(c, depth + 1))}</ul>
        ) : null}
      </li>
    );
  };

  const rootNode = nodes[rootId] ?? EMPTY;
  const rootName = (crumbs && crumbs.length > 0 ? crumbs[0].name : null) ?? "Home";

  return (
    <nav className="foldertree" aria-label="Pohon folder">
      <h2 className="tree-title">Folder</h2>
      <ul className="tree-root">
        <li className={`tree-item${activeId === rootId ? " current" : ""}`} style={{ "--depth": 0 } as CSSProperties}>
          <div className="tree-row">
            <button
              className="tree-chev"
              onClick={() => toggle(rootId)}
              aria-expanded={rootNode.expanded}
              aria-label={`${rootNode.expanded ? "Tutup" : "Buka"} folder ${rootName}`}
            >
              {rootNode.loading ? <SpinnerDot /> : rootNode.expanded ? <ChevDownGlyph /> : <ChevRightGlyph />}
            </button>
            <button className="tree-open" onClick={() => go(rootId)} title={rootName}>
              <FolderGlyph />
              <span className="tree-label">{rootName}</span>
            </button>
          </div>
          {rootNode.failed ? (
            <div className="tree-fail">
              <span>Gagal memuat.</span>
              <button onClick={() => void load(rootId, true)}>Coba lagi</button>
            </div>
          ) : null}
          {rootNode.children && rootNode.expanded ? (
            <ul className="tree-children">{rootNode.children.map((c) => renderEntry(c, 1))}</ul>
          ) : null}
        </li>
      </ul>
      <span className="sr-only">{open ? "Pohon folder terbuka" : ""}</span>
    </nav>
  );
}

function FolderGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function ChevRightGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function ChevDownGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function SpinnerDot() {
  return <span className="tree-spinner" aria-hidden="true" />;
}