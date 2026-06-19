// Post-login/registration landing (Kratos after-flow return URL). Ensures the session is loaded,
// then returns to the app.

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext.tsx';

export function Callback() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    (async () => {
      await refresh();
      navigate('/', { replace: true });
    })();
  }, [refresh, navigate]);
  return <p className="mt-16 text-center text-sm text-muted-foreground">Влизане…</p>;
}

export function AuthError() {
  return (
    <div className="mx-auto mt-16 max-w-sm space-y-3 px-4 text-center">
      <h1 className="text-xl font-semibold">Грешка при удостоверяване</h1>
      <p className="text-sm text-muted-foreground">
        Нещо се обърка.{' '}
        <a className="text-primary hover:underline" href="/auth/login">
          Опитайте отново
        </a>
        .
      </p>
    </div>
  );
}
