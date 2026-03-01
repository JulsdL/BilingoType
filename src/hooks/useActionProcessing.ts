import { useState, useCallback, useRef } from "react";

export type ActionProcessingState = "idle" | "processing" | "success";

interface ActionProcessingOptions {
  onSuccess: (enhancedContent: string, prompt: string) => void;
  onError: (errorMessage: string) => void;
}

interface ActionLike {
  prompt: string;
  name: string;
}

/**
 * Stub hook for action processing.
 * TODO: Re-implement with local LLM in Phase 2.
 */
export function useActionProcessing({ onError }: ActionProcessingOptions) {
  const [state, setState] = useState<ActionProcessingState>("idle");
  const [actionName, setActionName] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runAction = useCallback(
    (_action: ActionLike, _content: string) => {
      onError("LLM action processing is not yet available. This feature will be enabled in a future update.");
    },
    [onError]
  );

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setState("idle");
    setActionName(null);
  }, []);

  return { state, actionName, runAction, cancel };
}
