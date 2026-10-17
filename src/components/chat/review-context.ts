import { createContext } from "react";

export const OpenReviewContext = createContext<(() => void) | undefined>(undefined);
