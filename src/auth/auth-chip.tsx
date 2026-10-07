import { useAuth } from './auth-context';

export function AuthChip() {
  const { user, isAdmin, ready, openLogin, signOut } = useAuth();

  if (!ready) return null;

  if (!user) {
    return (
      <button type="button" className="auth-chip" onClick={openLogin}>
        Sign in
      </button>
    );
  }

  return (
    <div className="auth-chip auth-chip--user">
      {user.picture ? (
        <img className="auth-chip__avatar" src={user.picture} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span className="auth-chip__avatar auth-chip__avatar--fallback" aria-hidden="true">
          {user.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="auth-chip__meta">
        <span className="auth-chip__name">{user.name}</span>
        {isAdmin ? <span className="auth-chip__badge">Admin</span> : null}
      </span>
      <button type="button" className="auth-chip__signout" onClick={signOut}>
        Sign out
      </button>
    </div>
  );
}
