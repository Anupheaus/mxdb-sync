import { describe, expect, it } from 'vitest';
import { AuthContext } from './AuthContext';

// React createContext stores the default value in `_currentValue` on the context object.
// This is a stable React internals property used across all supported React 18 versions.
function getDefaultValue<T>(ctx: React.Context<T>): T {
  return (ctx as unknown as { _currentValue: T })._currentValue;
}

describe('AuthContext — default value', () => {
  it('isAuthenticated is false', () => {
    expect(getDefaultValue(AuthContext).isAuthenticated).toBe(false);
  });

  it('signOut is a callable no-op that does not throw', () => {
    expect(() => getDefaultValue(AuthContext).signOut()).not.toThrow();
  });

  it('register rejects with an error indicating the provider is not mounted', async () => {
    await expect(getDefaultValue(AuthContext).register('http://example.com')).rejects.toThrow(
      'AuthProvider not mounted',
    );
  });

  it('register rejects when called with options', async () => {
    await expect(
      getDefaultValue(AuthContext).register('http://example.com', { displayName: 'Alice' }),
    ).rejects.toThrow('AuthProvider not mounted');
  });
});
