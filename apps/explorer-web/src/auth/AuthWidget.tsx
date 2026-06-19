// Header auth control (spec 019): login link when anonymous; email + admin-settings link + logout
// when signed in.

import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext.tsx';

export function AuthWidget() {
  const { loading, user, isAdmin, logout } = useAuth();
  if (loading) return null;
  if (!user) {
    return (
      <Link to="/auth/login" className="text-sm text-primary hover:underline">
        Вход
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      {isAdmin ? (
        <Link to="/admin/settings" className="text-primary hover:underline">
          Настройки
        </Link>
      ) : null}
      <span className="hidden text-muted-foreground sm:inline">{user.email}</span>
      <button type="button" onClick={() => void logout()} className="text-primary hover:underline">
        Изход
      </button>
    </div>
  );
}
