/**
 * Optional Vitest `setupFiles` entry: installs browser globals before any test module loads.
 * You can skip this and rely on {@link installBrowserEnvironment} inside {@link setupE2E} instead.
 */
import { installBrowserEnvironment } from './browserEnvironment';

installBrowserEnvironment();
