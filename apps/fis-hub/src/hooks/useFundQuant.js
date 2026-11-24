import { useState, useEffect, useCallback } from 'react';
import { authHeaders } from '../utils/auth';

const PREMIUM_ROLES = new Set(['premium', 'advisor', 'admin']);

export function useFundQuant({ activeTab, currentUser }) {
  const [health, setHealth] = useState(null);
  const [funds, setFunds] = useState([]);
  const [facets, setFacets] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [detailSlug, setDetailSlug] = useState(null);
  const [compareSlugs, setCompareSlugs] = useState([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const canAccessQuant = Boolean(currentUser && PREMIUM_ROLES.has(currentUser.role));

  const refreshHealth = useCallback(() => {
    fetch('/api/quant/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setHealth(data);
      })
      .catch(() => {});
  }, []);

  const refreshFunds = useCallback(() => {
    if (!canAccessQuant) return;
    setLoading(true);
    setError(null);
    fetch('/api/quant/funds', { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) {
          const msg = await res.text();
          throw new Error(msg || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        setFunds(Array.isArray(data.items) ? data.items : []);
        setFacets(data.facets || null);
      })
      .catch((e) => {
        setError(e.message || 'Failed to load fund quant catalog');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [canAccessQuant]);

  useEffect(() => {
    let active = true;
    fetch('/api/quant/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) setHealth(data);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!canAccessQuant) return;
    if (!(activeTab === 'funds' || activeTab === 'lab' || activeTab === 'portfolios')) return;
    if (funds.length > 0) return;

    let active = true;
    fetch('/api/quant/funds', { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        setFunds(Array.isArray(data.items) ? data.items : []);
        setFacets(data.facets || null);
      })
      .catch((e) => {
        if (active) setError(e.message || 'Failed to load fund quant catalog');
      });
    return () => { active = false; };
  }, [activeTab, canAccessQuant, funds.length]);

  const toggleCompareSlug = (slug) => {
    setCompareSlugs((prev) => {
      if (prev.includes(slug)) return prev.filter((s) => s !== slug);
      if (prev.length >= 6) return prev;
      return [...prev, slug];
    });
  };

  return {
    health,
    funds,
    facets,
    loading,
    error,
    canAccessQuant,
    detailSlug,
    setDetailSlug,
    compareSlugs,
    setCompareSlugs,
    toggleCompareSlug,
    compareOpen,
    setCompareOpen,
    refreshFunds,
    refreshHealth,
  };
}
