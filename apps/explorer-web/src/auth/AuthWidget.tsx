// Header auth control (spec 019): a "Вход" link when anonymous; an avatar dropdown (UserMenu) with
// settings + logout when signed in. Rendered on the blue `bg-primary` header.

import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext.tsx';
import { UserMenu } from './UserMenu.tsx';

export function AuthWidget() {
  const { loading, user, isAdmin, logout } = useAuth();
  if (loading) return null;
  if (!user) {
    return (
      <Link
        to="/auth/login"
        className="text-sm text-primary-foreground/90 hover:text-primary-foreground hover:underline"
      >
        Вход
      </Link>
    );
  }
  return <UserMenu user={user} isAdmin={isAdmin} onLogout={() => void logout()} />;
}
