import { createContext } from 'react';

export interface ConflictResolutionContextProps {
  onConflictResolution?: (message: string) => Promise<boolean>;
}

export const ConflictResolutionContext = createContext<ConflictResolutionContextProps>({});
