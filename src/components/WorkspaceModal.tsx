import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ptyClient, DirectoryListing } from '../core/ptyClient';
import { SessionStore } from '../core/sessionStore';
import { audioEngine } from '../core/audioEngine';

interface WorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectWorkspace: (path: string, name?: string) => void;
}

export const WorkspaceModal: React.FC<WorkspaceModalProps> = ({
  isOpen,
  onClose,
  onSelectWorkspace,
}) => {
  const [currentPath, setCurrentPath] = useState<string>('~');
  const [inputQuery, setInputQuery] = useState<string>('');
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [recentWorkspaces, setRecentWorkspaces] = useState<{ name: string; path: string }[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);

  const loadDirectory = useCallback(async (path: string) => {
    setIsLoading(true);
    try {
      const res = await ptyClient.browseDirectory(path);
      setListing(res);
      setCurrentPath(res.current_path);
      setSelectedIndex(0);
    } catch (e) {
      console.error('Failed to browse directory:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setRecentWorkspaces(SessionStore.loadRecentWorkspaces());
      loadDirectory(currentPath);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, currentPath, loadDirectory]);

  // Combine items: Action buttons, Parent directory (if any), Entries, Recent workspaces
  interface ModalItem {
    id: string;
    kind: 'ACTION' | 'PARENT' | 'RECENT' | 'FOLDER';
    label: string;
    detail: string;
    action: () => void;
  }

  const items: ModalItem[] = [];

  // Action 1: Open current folder
  items.push({
    id: 'open-current',
    kind: 'ACTION',
    label: `OPEN: ${currentPath}`,
    detail: 'SELECT CURRENT',
    action: () => {
      audioEngine.playSound('pickup', 2);
      onSelectWorkspace(currentPath);
      onClose();
    },
  });

  // Action 2: Native Dialog (if in Tauri)
  if (ptyClient.getIsTauri()) {
    items.push({
      id: 'open-native',
      kind: 'ACTION',
      label: 'Open Native File Dialog…',
      detail: 'SYSTEM DIALOG',
      action: async () => {
        try {
          const tauri = (window as unknown as { __TAURI__?: { dialog?: { open?: (opts: unknown) => Promise<string | null> } } }).__TAURI__;
          if (tauri?.dialog?.open) {
            const selected = await tauri.dialog.open({
              directory: true,
              multiple: false,
              title: 'Select Doom Term Workspace Folder',
            });
            if (selected && typeof selected === 'string') {
              audioEngine.playSound('pickup', 2);
              onSelectWorkspace(selected);
              onClose();
            }
          }
        } catch (e) {
          console.warn('Native open dialog failed:', e);
        }
      },
    });
  }

  // Parent directory navigation
  if (listing?.parent_path) {
    items.push({
      id: 'nav-parent',
      kind: 'PARENT',
      label: '.. (Parent Directory)',
      detail: listing.parent_path,
      action: () => {
        audioEngine.playSound('click', 3);
        loadDirectory(listing.parent_path!);
      },
    });
  }

  // Directory entries matching filter
  if (listing) {
    const filtered = listing.entries.filter((e) =>
      e.is_dir && (!inputQuery || e.name.toLowerCase().includes(inputQuery.toLowerCase()))
    );

    for (const entry of filtered) {
      items.push({
        id: entry.path,
        kind: 'FOLDER',
        label: entry.name,
        detail: entry.is_git_repo ? 'GIT REPOSITORY' : 'DIRECTORY',
        action: () => {
          audioEngine.playSound('click', 3);
          loadDirectory(entry.path);
        },
      });
    }
  }

  // Recent Workspaces (when search is empty)
  if (!inputQuery && recentWorkspaces.length > 0) {
    for (const rec of recentWorkspaces) {
      items.push({
        id: `recent-${rec.path}`,
        kind: 'RECENT',
        label: rec.name,
        detail: rec.path,
        action: () => {
          audioEngine.playSound('pickup', 2);
          onSelectWorkspace(rec.path, rec.name);
          onClose();
        },
      });
    }
  }

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, items.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + items.length) % Math.max(1, items.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[selectedIndex]) {
        items[selectedIndex].action();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="panel plate w-full max-w-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Panel Header */}
        <div className="ph flex justify-between items-center text-[11.5px] font-bold tracking-widest px-1 py-1 text-[#22201b]">
          <span>OPEN WORKSPACE · MACHINE FILESYSTEM</span>
          <span className="text-[10px] opacity-75">↑↓ NAV · ENTER SELECT · ESC CLOSE</span>
        </div>

        {/* Panel Body (Recessed) */}
        <div className="pb recess p-2 bg-[#14120f]">
          {/* Path / Search Input */}
          <div className="field recess flex items-center gap-2 px-2 py-1.5 mb-2 bg-[#1b1814] border border-[#2f2f2e]">
            <span style={{ color: 'var(--st-live)' }} className="font-bold">▸</span>
            <input
              ref={inputRef}
              type="text"
              value={inputQuery}
              onChange={(e) => {
                setInputQuery(e.target.value);
                setSelectedIndex(0);
              }}
              placeholder={`Current: ${currentPath} (type to filter or type full path)...`}
              className="bg-transparent text-[#d8cbb0] placeholder-[#8f8672] font-mono text-[12px] w-full focus:outline-none"
            />
            {isLoading && <span className="text-[10px] text-[#e0a92c] animate-pulse">READING…</span>}
          </div>

          {/* Directory & Workspace List */}
          <div className="max-h-72 overflow-y-auto flex flex-col gap-1 pr-1">
            {items.length === 0 ? (
              <div className="p-4 text-center text-xs font-mono text-[#8f8672]">
                No matching folders found in this directory.
              </div>
            ) : (
              items.map((item, idx) => {
                const isSelected = idx === selectedIndex;

                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      setSelectedIndex(idx);
                      item.action();
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`row flex items-center gap-3 px-2 py-1 cursor-pointer font-mono text-[12px] transition-none ${
                      isSelected
                        ? 'row sel plate text-[#3a2a04] font-bold'
                        : 'text-[#d8cbb0] hover:bg-[#1b1814]'
                    }`}
                  >
                    <span
                      className="k w-16 shrink-0 text-[10px] tracking-wider uppercase font-bold"
                      style={{
                        color: isSelected
                          ? '#3d3830'
                          : item.kind === 'ACTION'
                          ? 'var(--st-live)'
                          : item.kind === 'RECENT'
                          ? 'var(--st-pass)'
                          : 'var(--ink-dim)',
                      }}
                    >
                      {item.kind}
                    </span>
                    <span className="v flex-1 truncate text-left">{item.label}</span>
                    <span
                      className="r shrink-0 text-[10.5px] tabular-nums"
                      style={{ color: isSelected ? '#3d3830' : 'var(--ink-dim)' }}
                    >
                      {item.detail}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
