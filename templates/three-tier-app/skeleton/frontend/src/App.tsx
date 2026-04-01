import React, { useEffect, useState, useCallback } from 'react';

interface Item {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'inactive' | 'archived';
  created_at: string;
  updated_at: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Health {
  status: string;
  service: string;
  version: string;
  timestamp: string;
}

const API = '/api/items';

const STATUS_COLORS: Record<string, string> = {
  active: 'var(--green)',
  inactive: 'var(--amber)',
  archived: 'var(--text-muted)',
};

export function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const fetchItems = useCallback(async (page = 1) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '10' });
    if (search) params.set('search', search);
    const res = await fetch(`${API}?${params}`);
    const data = await res.json();
    setItems(data.items);
    setPagination(data.pagination);
    setLoading(false);
  }, [search]);

  useEffect(() => {
    fetchItems();
    fetch('/health').then(r => r.json()).then(setHealth).catch(() => {});
  }, [fetchItems]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, description: newDesc || undefined }),
    });
    setNewName('');
    setNewDesc('');
    fetchItems();
  };

  const handleDelete = async (id: string) => {
    await fetch(`${API}/${id}`, { method: 'DELETE' });
    fetchItems();
  };

  const handleToggleStatus = async (item: Item) => {
    const next = item.status === 'active' ? 'inactive' : 'active';
    await fetch(`${API}/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    fetchItems();
  };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em' }}>
          ${{ values.appName | title }}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: 4 }}>
          ${{ values.description }}
        </p>
        {health && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12,
            padding: '4px 12px', borderRadius: 100, border: '1px solid var(--border)',
            fontSize: '0.75rem', color: 'var(--text-muted)',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: health.status === 'healthy' ? 'var(--green)' : 'var(--red)',
            }} />
            {health.service} v{health.version}
          </div>
        )}
      </header>

      {/* Create form */}
      <form onSubmit={handleCreate} style={{
        display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap',
      }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Item name…"
          style={{
            flex: 1, minWidth: 200, height: 40, padding: '0 12px',
            borderRadius: 6, border: '1px solid var(--border)',
            background: 'var(--surface)', color: 'var(--text)', fontSize: '0.875rem',
          }}
        />
        <input
          value={newDesc}
          onChange={e => setNewDesc(e.target.value)}
          placeholder="Description (optional)…"
          style={{
            flex: 2, minWidth: 200, height: 40, padding: '0 12px',
            borderRadius: 6, border: '1px solid var(--border)',
            background: 'var(--surface)', color: 'var(--text)', fontSize: '0.875rem',
          }}
        />
        <button type="submit" style={{
          height: 40, padding: '0 20px', borderRadius: 6, border: 'none',
          background: 'var(--text)', color: 'var(--bg)',
          fontSize: '0.875rem', fontWeight: 600,
        }}>
          Add Item
        </button>
      </form>

      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search items…"
          style={{
            width: '100%', height: 36, padding: '0 12px',
            borderRadius: 6, border: '1px solid var(--border)',
            background: 'var(--surface)', color: 'var(--text)', fontSize: '0.8125rem',
          }}
        />
      </div>

      {/* Table */}
      <div style={{
        border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        overflow: 'hidden', background: 'var(--surface)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={th}>Name</th>
              <th style={th}>Description</th>
              <th style={th}>Status</th>
              <th style={th}>Created</th>
              <th style={{ ...th, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No items found</td></tr>
            ) : items.map(item => (
              <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ ...td, fontWeight: 500 }}>{item.name}</td>
                <td style={{ ...td, color: 'var(--text-secondary)' }}>{item.description ?? '—'}</td>
                <td style={td}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '2px 8px', borderRadius: 100, fontSize: '0.75rem', fontWeight: 500,
                    border: '1px solid var(--border)', color: STATUS_COLORS[item.status],
                  }}>
                    {item.status}
                  </span>
                </td>
                <td style={{ ...td, color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                  {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(item.created_at))}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <button onClick={() => handleToggleStatus(item)} style={actionBtn}>
                    {item.status === 'active' ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => handleDelete(item.id)} style={{ ...actionBtn, color: 'var(--red)', borderColor: 'var(--red)' }}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 16px', borderTop: '1px solid var(--border)',
            fontSize: '0.8125rem', color: 'var(--text-muted)',
          }}>
            <span>{pagination.total} items</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {Array.from({ length: pagination.totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => fetchItems(i + 1)}
                  style={{
                    width: 28, height: 28, borderRadius: 4,
                    border: pagination.page === i + 1 ? '1px solid var(--blue)' : '1px solid var(--border)',
                    background: pagination.page === i + 1 ? 'var(--blue)' : 'transparent',
                    color: pagination.page === i + 1 ? '#fff' : 'var(--text-secondary)',
                    fontSize: '0.75rem', fontWeight: 500,
                  }}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '10px 16px', textAlign: 'left', fontSize: '0.75rem',
  fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
  color: 'var(--text-muted)',
};

const td: React.CSSProperties = {
  padding: '12px 16px',
};

const actionBtn: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-secondary)',
  fontSize: '0.75rem', fontWeight: 500, marginLeft: 4,
};
