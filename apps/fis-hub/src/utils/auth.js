const TOKEN_KEY = 'ph_token';
const USER_KEY  = 'ph_user';

export const authStorage = {
  setToken: (token) => localStorage.setItem(TOKEN_KEY, token),
  getToken: () => localStorage.getItem(TOKEN_KEY),
  removeToken: () => localStorage.removeItem(TOKEN_KEY),
  setUser: (user) => localStorage.setItem(USER_KEY, JSON.stringify(user)),
  getUser: () => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
    catch { return null; }
  },
  removeUser: () => localStorage.removeItem(USER_KEY),
  clear: () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); },
};

// 给 fetch 用的 Authorization Header
export const authHeaders = () => {
  const token = authStorage.getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};

// 角色层级判断
const ROLE_RANK = { free: 0, premium: 1, advisor: 2, admin: 3 };
export const hasRole = (userRole, minRole) =>
  (ROLE_RANK[userRole] ?? -1) >= (ROLE_RANK[minRole] ?? 99);

export const canViewInternalWarnings = (user) =>
  user?.role === 'advisor' || user?.role === 'admin';
