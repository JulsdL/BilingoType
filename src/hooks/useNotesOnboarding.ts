import { useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage";

const ONBOARDING_KEY = "notes-onboarding-complete";

export function useNotesOnboarding() {
  const [isComplete, setIsComplete] = useLocalStorage(ONBOARDING_KEY, false);

  const complete = useCallback(() => {
    setIsComplete(true);
  }, [setIsComplete]);

  return { isComplete, complete };
}
