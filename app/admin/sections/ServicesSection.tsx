import { useState } from 'react';
import { IconPaw, IconTag, SERVICE_ICONS } from '../../shared-ui/icons';
import { ServiceEditor } from './ServiceEditor.js';
import type { ServiceForm, Settings, SettingsSectionProps } from '../shared.js';

function ServiceIcon({ icon }: { icon: string }) {
  const Icon = SERVICE_ICONS[icon] ?? IconPaw;
  return <Icon size={16} />;
}

function AddServiceForm({
  templates,
  addService,
}: {
  templates: Settings['templates'];
  addService: (template: string, label: string) => Promise<void>;
}) {
  const [template, setTemplate] = useState(templates[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy || !label.trim() || !template) return;
    setBusy(true);
    try {
      await addService(template, label.trim());
      setLabel('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pb-inline">
      <select value={template} onChange={(e) => setTemplate(e.target.value)}>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      <input
        type="text"
        placeholder="Service name"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <button type="button" onClick={() => void submit()} disabled={busy}>
        {busy ? 'Adding…' : 'Add service'}
      </button>
    </div>
  );
}

export function ServicesSection({
  settings,
  setSettings,
  addService,
  removeService,
  openWizard,
}: SettingsSectionProps & {
  addService: (template: string, label: string) => Promise<void>;
  removeService: (type: string) => Promise<void>;
  openWizard: () => void;
}) {
  return (
    <>
      <h2>
        <IconTag size={18} /> Services &amp; rates
      </h2>
      <p>
        <button type="button" onClick={openWizard}>
          Quick setup
        </button>{' '}
        <span className="pb-hint">
          One-tap presets for common offerings — additive, never overwrites.
        </span>
      </p>
      <p className="pb-applies">
        Tick the services you offer. To create a new offering clients can book (say, a 30-minute
        &ldquo;Puppy Check-in&rdquo;), add it as an option under Walks or Check-ins with its own
        name, length, and price.
      </p>
      {settings.services.map((s, si) => {
        const setService = (next: ServiceForm) => {
          const services = [...settings.services];
          services[si] = next;
          setSettings({ ...settings, services });
        };
        return (
          <div className="pb-service" key={s.type}>
            <label className="pb-inline">
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={(e) => setService({ ...s, enabled: e.target.checked })}
              />
              <ServiceIcon icon={s.icon} /> {s.label}
            </label>
            <ServiceEditor
              service={s}
              setService={setService}
              onDelete={
                s.custom
                  ? () => {
                      if (window.confirm(`Delete "${s.label}"? This removes it immediately.`))
                        void removeService(s.type);
                    }
                  : undefined
              }
            />
          </div>
        );
      })}
      <div className="pb-service">
        <h3>Add service</h3>
        <AddServiceForm templates={settings.templates} addService={addService} />
      </div>
    </>
  );
}
