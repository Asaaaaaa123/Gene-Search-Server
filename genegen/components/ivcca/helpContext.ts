'use client';

import { createContext, useContext } from 'react';
import type { ToolId } from './types';

/** Lets any panel open the help drawer (optionally for a specific tool). */
export const HelpContext = createContext<{ openHelp: (tool?: ToolId) => void } | null>(null);

export const useHelp = () => useContext(HelpContext);

/** Section the guide page should open and scroll to when it mounts (set by the help drawer). */
export const pendingGuideSection: { current: string | null } = { current: null };
