import { useState } from 'react';
import { IconPaw } from '../../shared-ui/icons';
import type { SettingsSectionProps } from '../shared.js';

/**
 * Pet-type management home. The enable checkbox edits the staged settings draft (save bar),
 * exactly as before; add/rename/delete are IMMEDIATE calls + settings refresh — the services
 * add/delete pattern. Delete is confirm-guarded; a referenced type surfaces the server's
 * 409 "disable it instead" copy via the dashboard error banner.
 */
export function PetsSection({
  settings,
  setSettings,
  addPetType,
  renamePetType,
  removePetType,
}: SettingsSectionProps & {
  addPetType: (label: string) => Promise<void>;
  renamePetType: (petType: string, label: string) => Promise<void>;
  removePetType: (petType: string) => Promise<void>;
}) {
  const [newLabel, setNewLabel] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const submitAdd = async () => {
    if (busy || !newLabel.trim()) return;
    setBusy(true);
    try {
      await addPetType(newLabel.trim());
      setNewLabel('');
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async (petType: string) => {
    if (busy || !editLabel.trim()) return;
    setBusy(true);
    try {
      await renamePetType(petType, editLabel.trim());
      setEditing(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2>
        <IconPaw size={18} /> Pets you care for
      </h2>
      <p className="pb-applies">
        Which types of pets you accept — add your own (rabbits, birds, reptiles…). The checkbox
        turns a type on or off everywhere; per-service exceptions live on each service&apos;s card
        under Services. Your clients&apos; individual pets live under Clients.
      </p>
      {settings.petTypes.map((p, i) => (
        <div className="pb-inline" key={p.petType}>
          <label className="pb-inline">
            <input
              type="checkbox"
              checked={p.enabled}
              onChange={(e) => {
                const petTypes = [...settings.petTypes];
                petTypes[i] = { ...p, enabled: e.target.checked };
                setSettings({ ...settings, petTypes });
              }}
            />
            {p.label}
          </label>
          {editing === p.petType ? (
            <>
              <input
                value={editLabel}
                aria-label={`New name for ${p.label}`}
                onChange={(e) => setEditLabel(e.target.value)}
              />
              <button type="button" disabled={busy} onClick={() => void submitRename(p.petType)}>
                Save
              </button>
              <button type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditing(p.petType);
                  setEditLabel(p.label);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="pb-danger"
                onClick={() => {
                  if (!window.confirm(`Delete "${p.label}"? This removes it immediately.`)) return;
                  void removePetType(p.petType);
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      ))}
      <div className="pb-inline">
        <input
          type="text"
          placeholder="Pet type name (e.g. Rabbits)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
        />
        <button type="button" onClick={() => void submitAdd()} disabled={busy}>
          {busy ? 'Adding…' : 'Add a pet type'}
        </button>
      </div>
    </>
  );
}
