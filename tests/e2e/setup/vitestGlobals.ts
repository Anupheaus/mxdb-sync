/**
 * Vitest `setupFiles` entry (e2e + stress): installs browser globals before any test module loads.
 * You can skip this and rely on {@link installBrowserEnvironment} inside {@link setupE2E} instead.
 */
import { installBrowserEnvironment } from './browserEnvironment';

installBrowserEnvironment();
