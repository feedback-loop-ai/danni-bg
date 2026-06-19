// Header auth control (spec 019): login link when anonymous; settings + email + logout when signed
// in (admins also get the platform-settings link). Rendered on the blue `bg-primary` header, so it
// uses `text-primary-foreground` for contrast — `text-primary` would be blue-on-blue and invisible.

import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext.tsx';

const LINK = 'text-primary-foreground/90 hover:text-primary-foreground hover:underline';

export function AuthWidget() {
  const { loading, user, isAdmin, logout } = useAuth();
  if (loading) return null;
  if (!user) {
    return (
      <Link to="/auth/login" className={`text-sm ${LINK}`}>
        Вход
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      <Link to="/auth/settings" className={LINK}>
        Настройки
      </Link>
      {isAdmin ? (
        <Link to="/admin/settings" className={LINK}>
          Платформа
        </Link>
      ) : null}
      <span className="hidden text-primary-foreground/70 sm:inline">{user.email}</span>
      <button type="button" onClick={() => void logout()} className={LINK}>
        Изход
      </button>
    </div>
  );
}
