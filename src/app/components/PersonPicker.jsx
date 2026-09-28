import { useState, useRef } from 'react';
import { peopleSearchText, initialsOf } from '../core.js';

// Real interactive React combobox replacing app.js's personPicker()/attachPersonPickers()
// (which built a hidden <input> + manually rebound focus/input/keydown/blur/mousedown
// listeners on plain DOM nodes). Same behaviour — type to filter, arrow keys, Enter to
// pick, click to pick, Escape to close — implemented as component state instead.
export default function PersonPicker({ people, placeholder = 'Search by name, unit or DID…', onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [selectedDid, setSelectedDid] = useState('');
  const blurTimer = useRef(null);

  if (!people.length) return <div className="text-muted" style={{ fontSize: 12.5, padding: '8px 0' }}>No one else to choose</div>;

  const q = query.trim().toLowerCase();
  const visible = people.filter(u => !q || peopleSearchText(u).includes(q));

  function choose(u) {
    setSelectedDid(u.did);
    setQuery(u.name);
    setOpen(false);
    onChange && onChange(u.did);
  }
  function handleInput(e) {
    setQuery(e.target.value);
    setOpen(true);
    setActive(0);
    if (selectedDid) { setSelectedDid(''); onChange && onChange(''); }
  }
  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, visible.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const u = visible[Math.max(active, 0)]; if (u) choose(u); }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  return (
    <div className="person-picker">
      <input type="search" className="pp-input" placeholder={placeholder} autoComplete="off" aria-label={placeholder}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 120); }}
      />
      <div className="pp-list" hidden={!open}>
        {visible.map((u, i) => (
          <button
            type="button"
            key={u.did}
            className={`pp-opt${i === active ? ' active' : ''}`}
            // mousedown fires before the input's blur closes the list
            onMouseDown={e => { e.preventDefault(); if (blurTimer.current) clearTimeout(blurTimer.current); choose(u); }}
          >
            <div className={`avatar dir-av dir-av-${u.role.toLowerCase()}`} style={{ width: 28, height: 28, fontSize: 10 }}>{initialsOf(u.name)}</div>
            <span className="pp-text">
              <span className="pp-name">{u.name}</span>
              <span className="pp-sub">{u.designation} · {u.orgUnit} · <span className="mono">{u.did}</span></span>
            </span>
          </button>
        ))}
        {visible.length === 0 && <div className="pp-empty">No one matches</div>}
      </div>
    </div>
  );
}
