// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { AuthContext, type AuthContextValue } from './AuthContext';
import { useAuth } from '../hooks/useAuth';
import { useMXDBSignOut } from '../hooks/useMXDBSignOut';
import { useMXDBInvite } from '../hooks/useMXDBInvite';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── shared helpers ────────────────────────────────────────────────────────────

function makeContextValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    isAuthenticated: false,
    user: undefined,
    signOut: vi.fn(),
    register: vi.fn().mockResolvedValue({ userDetails: { id: 'user-1', name: 'alice@example.com', displayName: 'Alice' } }),
    ...overrides,
  };
}

function renderWithAuthContext(
  contextValue: AuthContextValue,
  component: (container: HTMLDivElement) => React.ReactElement,
): { container: HTMLDivElement; root: Root; cleanup: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      createElement(
        AuthContext.Provider,
        { value: contextValue },
        component(container),
      ),
    );
  });

  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

// ─── useAuth ──────────────────────────────────────────────────────────────────

describe('useAuth', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('returns isAuthenticated: false when context value is false', () => {
    const ctx = makeContextValue({ isAuthenticated: false });
    let result: ReturnType<typeof useAuth> | undefined;

    function Probe() {
      result = useAuth();
      return null;
    }

    const rendered = renderWithAuthContext(ctx, () => createElement(Probe));
    cleanup = rendered.cleanup;

    expect(result?.isAuthenticated).toBe(false);
  });

  it('returns isAuthenticated: true when context value is true', () => {
    const ctx = makeContextValue({ isAuthenticated: true });
    let result: ReturnType<typeof useAuth> | undefined;

    function Probe() {
      result = useAuth();
      return null;
    }

    const rendered = renderWithAuthContext(ctx, () => createElement(Probe));
    cleanup = rendered.cleanup;

    expect(result?.isAuthenticated).toBe(true);
  });

  it('returns user: undefined when context has no user', () => {
    const ctx = makeContextValue({ user: undefined });
    let result: ReturnType<typeof useAuth> | undefined;

    function Probe() {
      result = useAuth();
      return null;
    }

    const rendered = renderWithAuthContext(ctx, () => createElement(Probe));
    cleanup = rendered.cleanup;

    expect(result?.user).toBeUndefined();
  });

  it('returns user details when context has a user', () => {
    const user = { id: 'u-1', name: 'alice@example.com', displayName: 'Alice' };
    const ctx = makeContextValue({ isAuthenticated: true, user });
    let result: ReturnType<typeof useAuth> | undefined;

    function Probe() {
      result = useAuth();
      return null;
    }

    const rendered = renderWithAuthContext(ctx, () => createElement(Probe));
    cleanup = rendered.cleanup;

    expect(result?.user).toEqual(user);
  });

  it('reflects a context update when the provider value changes', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    let result: ReturnType<typeof useAuth> | undefined;

    function Probe() {
      result = useAuth();
      return null;
    }

    function renderWith(isAuthenticated: boolean) {
      const ctx = makeContextValue({ isAuthenticated });
      act(() => {
        root.render(createElement(AuthContext.Provider, { value: ctx }, createElement(Probe)));
      });
    }

    cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };

    renderWith(false);
    expect(result?.isAuthenticated).toBe(false);

    renderWith(true);
    expect(result?.isAuthenticated).toBe(true);
  });
});

// ─── useMXDBSignOut ───────────────────────────────────────────────────────────

describe('useMXDBSignOut', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('returns a signOut function', () => {
    const ctx = makeContextValue();
    let result: { signOut(): void } | undefined;

    function Probe() {
      result = useMXDBSignOut();
      return null;
    }

    const rendered = renderWithAuthContext(ctx, () => createElement(Probe));
    cleanup = rendered.cleanup;

    expect(typeof result?.signOut).toBe('function');
  });

  it('calls the signOut from context when the returned signOut is invoked', () => {
    const signOutMock = vi.fn();
    const ctx = makeContextValue({ signOut: signOutMock });
    let result: { signOut(): void } | undefined;

    function Probe() {
      result = useMXDBSignOut();
      return null;
    }

    const rendered = renderWithAuthContext(ctx, () => createElement(Probe));
    cleanup = rendered.cleanup;

    act(() => {
      result?.signOut();
    });

    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it('does not call signOut on mount', () => {
    const signOutMock = vi.fn();
    const ctx = makeContextValue({ signOut: signOutMock });

    function Probe() {
      useMXDBSignOut();
      return null;
    }

    const rendered = renderWithAuthContext(ctx, () => createElement(Probe));
    cleanup = rendered.cleanup;

    expect(signOutMock).not.toHaveBeenCalled();
  });
});

// ─── useMXDBInvite ────────────────────────────────────────────────────────────

describe('useMXDBInvite', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('returns the register function from context', () => {
    const registerMock = vi.fn().mockResolvedValue({ userDetails: {} });
    const ctx = makeContextValue({ register: registerMock });
    let result: ReturnType<typeof useMXDBInvite> | undefined;

    function Probe() {
      result = useMXDBInvite();
      return null;
    }

    const rendered = renderWithAuthContext(ctx, () => createElement(Probe));
    cleanup = rendered.cleanup;

    expect(result).toBe(registerMock);
  });

  it('invoking the returned function calls context register with the given url', async () => {
    const registerMock = vi.fn().mockResolvedValue({ userDetails: { id: 'u1', name: 'bob@example.com', displayName: 'Bob' } });
    const ctx = makeContextValue({ register: registerMock });
    let result: ReturnType<typeof useMXDBInvite> | undefined;

    function Probe() {
      result = useMXDBInvite();
      return null;
    }

    const rendered = renderWithAuthContext(ctx, () => createElement(Probe));
    cleanup = rendered.cleanup;

    await act(async () => {
      await result?.('http://invite.example.com');
    });

    expect(registerMock).toHaveBeenCalledWith('http://invite.example.com');
  });

  it('invoking the returned function passes options to context register', async () => {
    const registerMock = vi.fn().mockResolvedValue({ userDetails: {} });
    const ctx = makeContextValue({ register: registerMock });
    let result: ReturnType<typeof useMXDBInvite> | undefined;

    function Probe() {
      result = useMXDBInvite();
      return null;
    }

    const rendered = renderWithAuthContext(ctx, () => createElement(Probe));
    cleanup = rendered.cleanup;

    const options = { displayName: 'Carol' };
    await act(async () => {
      await result?.('http://invite.example.com', options);
    });

    expect(registerMock).toHaveBeenCalledWith('http://invite.example.com', options);
  });
});
