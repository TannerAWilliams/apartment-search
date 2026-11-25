/**
 * Whether the person has said where they commute to, and how to ask them. Until they have, commute times are not
 * shown to a stand-in destination: cards say "? min to your job" and offer to add it.
 */
import { createContext } from 'react';

export const CommuteContext = createContext<{ known: boolean; add?: () => void }>({ known: true });
